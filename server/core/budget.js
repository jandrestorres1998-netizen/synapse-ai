import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from '../config/logger.js';

const log = createLogger('Budget');

/**
 * Spend limits, enforced before the money is spent.
 *
 * The gateway could already see the cost of every call but did nothing with it,
 * so a client stuck in a retry loop drained the operator's provider budget with
 * nothing to stop it. This is the piece that stops it.
 *
 * The awkward part is that the cost of a call is only known once it returns:
 * output tokens are not knowable in advance. Checking "spent so far" before the
 * call and adding the real cost after would let N concurrent requests each pass
 * the check and collectively blow through the cap. So this works in two steps:
 *
 *   reserve() — books an upper bound (prompt tokens plus the maximum output the
 *               request could produce) and refuses if that would exceed a cap.
 *   settle()  — replaces the reservation with the real cost once known.
 *   release() — drops the reservation when the call failed and cost nothing.
 *
 * Between reserve and settle the reservation counts against the budget, so
 * concurrent requests cannot overshoot. The trade is that a burst is throttled
 * against its worst case rather than its actual cost, which is the right way
 * round for a spend control.
 *
 * Periods are calendar days and months in UTC. State is persisted, because a
 * budget that resets on restart is not a budget: crashing the process would be
 * the way around it.
 */
export class BudgetLedger {
  /**
   * @param {Object} options
   * @param {string} options.dataDir
   * @param {number} options.dailyUsdPerTenant   0 disables the cap.
   * @param {number} options.monthlyUsdPerTenant
   * @param {number} options.dailyUsdGlobal      Across every tenant.
   * @param {number} options.monthlyUsdGlobal
   * @param {number} options.flushIntervalMs     Debounce for disk writes.
   */
  constructor({
    dataDir,
    dailyUsdPerTenant = 0,
    monthlyUsdPerTenant = 0,
    dailyUsdGlobal = 0,
    monthlyUsdGlobal = 0,
    flushIntervalMs = 5000
  } = {}) {
    this.limits = { dailyUsdPerTenant, monthlyUsdPerTenant, dailyUsdGlobal, monthlyUsdGlobal };
    this.filePath = dataDir ? path.join(dataDir, 'budget.json') : null;
    this.flushIntervalMs = flushIntervalMs;

    /** @type {Map<string, number>} "scope:period" → spent USD */
    this.spent = new Map();
    /** @type {Map<string, {tenantId: string, usd: number, at: number}>} */
    this.reservations = new Map();

    this._dirty = false;
    this._flushTimer = null;

    if (this.filePath) {
      fs.mkdirSync(dataDir, { recursive: true });
      this._load();
    }
  }

  static day(now = new Date()) {
    return now.toISOString().slice(0, 10);
  }

  static month(now = new Date()) {
    return now.toISOString().slice(0, 7);
  }

  /** Every bucket a single call counts against. */
  _keys(tenantId, now = new Date()) {
    return {
      tenantDaily: `t:${tenantId}:d:${BudgetLedger.day(now)}`,
      tenantMonthly: `t:${tenantId}:m:${BudgetLedger.month(now)}`,
      globalDaily: `g:d:${BudgetLedger.day(now)}`,
      globalMonthly: `g:m:${BudgetLedger.month(now)}`
    };
  }

  _get(key) {
    return this.spent.get(key) ?? 0;
  }

  /** Reserved but not yet settled, per bucket. */
  _reserved(tenantId) {
    let tenant = 0;
    let global = 0;
    for (const reservation of this.reservations.values()) {
      global += reservation.usd;
      if (reservation.tenantId === tenantId) tenant += reservation.usd;
    }
    return { tenant, global };
  }

  /**
   * Books an upper bound against the caps.
   * @returns {{allowed: boolean, reservationId?: string, reason?: string, limit?: number, spent?: number}}
   */
  reserve(tenantId, estimatedUsd, now = new Date()) {
    if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) estimatedUsd = 0;

    const keys = this._keys(tenantId, now);
    const held = this._reserved(tenantId);
    const { dailyUsdPerTenant, monthlyUsdPerTenant, dailyUsdGlobal, monthlyUsdGlobal } = this.limits;

    const checks = [
      { limit: dailyUsdPerTenant, current: this._get(keys.tenantDaily) + held.tenant, scope: 'diario del inquilino' },
      { limit: monthlyUsdPerTenant, current: this._get(keys.tenantMonthly) + held.tenant, scope: 'mensual del inquilino' },
      { limit: dailyUsdGlobal, current: this._get(keys.globalDaily) + held.global, scope: 'diario global' },
      { limit: monthlyUsdGlobal, current: this._get(keys.globalMonthly) + held.global, scope: 'mensual global' }
    ];

    for (const check of checks) {
      if (check.limit > 0 && check.current + estimatedUsd > check.limit) {
        return {
          allowed: false,
          reason: `Se alcanzó el límite de gasto ${check.scope}: $${check.current.toFixed(4)} de $${check.limit.toFixed(2)}, y esta petición podría costar hasta $${estimatedUsd.toFixed(4)}.`,
          scope: check.scope,
          limit: check.limit,
          spent: Number(check.current.toFixed(6))
        };
      }
    }

    const reservationId = crypto.randomBytes(8).toString('hex');
    this.reservations.set(reservationId, { tenantId, usd: estimatedUsd, at: Date.now() });

    return { allowed: true, reservationId, reservedUsd: estimatedUsd };
  }

  /** Replaces a reservation with the real cost. */
  settle(reservationId, actualUsd, now = new Date()) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return false;

    this.reservations.delete(reservationId);

    const amount = Number.isFinite(actualUsd) && actualUsd > 0 ? actualUsd : 0;
    for (const key of Object.values(this._keys(reservation.tenantId, now))) {
      this.spent.set(key, this._get(key) + amount);
    }

    this._markDirty();
    return true;
  }

  /** Drops a reservation that never became a charge. */
  release(reservationId) {
    return this.reservations.delete(reservationId);
  }

  /**
   * Reservations whose request never settled — a crash between the two, or a
   * bug. Cleared so they do not hold budget hostage forever.
   */
  expireStaleReservations(maxAgeMs = 10 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    let expired = 0;

    for (const [id, reservation] of this.reservations) {
      if (reservation.at < cutoff) {
        this.reservations.delete(id);
        expired++;
      }
    }

    if (expired > 0) log.warn('Reservas de presupuesto caducadas sin liquidar', { expired });
    return expired;
  }

  status(tenantId = 'default', now = new Date()) {
    const keys = this._keys(tenantId, now);
    const held = this._reserved(tenantId);

    const describe = (spent, reserved, limit) => ({
      spentUsd: Number(spent.toFixed(6)),
      reservedUsd: Number(reserved.toFixed(6)),
      limitUsd: limit > 0 ? limit : null,
      remainingUsd: limit > 0 ? Number(Math.max(0, limit - spent - reserved).toFixed(6)) : null,
      enforced: limit > 0
    });

    return {
      tenantId,
      period: { day: BudgetLedger.day(now), month: BudgetLedger.month(now) },
      tenant: {
        daily: describe(this._get(keys.tenantDaily), held.tenant, this.limits.dailyUsdPerTenant),
        monthly: describe(this._get(keys.tenantMonthly), held.tenant, this.limits.monthlyUsdPerTenant)
      },
      global: {
        daily: describe(this._get(keys.globalDaily), held.global, this.limits.dailyUsdGlobal),
        monthly: describe(this._get(keys.globalMonthly), held.global, this.limits.monthlyUsdGlobal)
      },
      openReservations: this.reservations.size,
      note: Object.values(this.limits).every(l => l === 0)
        ? 'Ningún límite configurado: el gateway contabiliza el gasto pero no lo detiene.'
        : undefined
    };
  }

  // ── Persistencia ──────────────────────────────────────────────────────────

  _markDirty() {
    if (!this.filePath) return;
    this._dirty = true;

    // Debounced: a disk write per request would dominate the latency of a
    // gateway whose own overhead is otherwise about a millisecond.
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, this.flushIntervalMs);
    this._flushTimer.unref?.();
  }

  /** Writes state to disk. Call on shutdown so the last window is not lost. */
  flush() {
    if (!this.filePath || !this._dirty) return;

    try {
      const tmp = `${this.filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, spent: Object.fromEntries(this.spent) }, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this._dirty = false;
    } catch (err) {
      log.error('No se pudo persistir el estado del presupuesto', { error: err.message });
    }
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const today = BudgetLedger.day();
      const thisMonth = BudgetLedger.month();
      let loaded = 0;

      for (const [key, value] of Object.entries(parsed.spent ?? {})) {
        // Drop buckets from periods that have already closed.
        if (key.includes(':d:') && !key.endsWith(today)) continue;
        if (key.includes(':m:') && !key.endsWith(thisMonth)) continue;
        this.spent.set(key, value);
        loaded++;
      }

      log.info('Estado de presupuesto restaurado', { buckets: loaded });
    } catch (err) {
      log.error('Estado de presupuesto ilegible; se empieza de cero', { error: err.message });
    }
  }
}

export class BudgetExceededError extends Error {
  constructor(detail) {
    super(detail.reason);
    this.name = 'BudgetExceededError';
    // 402 rather than 429: the request is not rate limited, it is unfunded.
    // Retrying in a second will not help; the period has to roll over or the
    // operator has to raise the cap.
    this.status = 402;
    this.detail = detail;
  }
}

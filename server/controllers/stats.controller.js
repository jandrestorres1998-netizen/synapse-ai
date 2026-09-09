import { dlp, cache, memory, router, providers, auditLedger, telemetry, integrity, budget, env } from '../config/container.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Stats');

/**
 * GET /api/stats — operational telemetry.
 * Every number here traces back to a measured event; see core/telemetry.js.
 */
export function getStats(req, res) {
  const snapshot = telemetry.snapshot();

  res.json({
    ...snapshot,
    cache: cache.getStats(),
    dlp: {
      totalDetections: dlp.getTotalInterceptions(),
      evasionAttemptsNormalized: dlp.getEvasionAttemptsBlocked(),
      plaintextRetention: env.DLP.STORE_PLAINTEXT_SAMPLES,
      mode: env.DLP.ON_DETECTION
    },
    activeMemories: memory.getAll().filter(m => m.isActive).length,
    providers: providers.status(),
    hasRealProvider: providers.hasRealProvider(),
    budget: budget.status(req.auth?.tenantId ?? 'default')
  });
}

/** GET /api/budget — spend against the configured caps for the caller's tenant. */
export function getBudget(req, res) {
  res.json(budget.status(req.auth?.tenantId ?? 'default'));
}

export function getSecurityLogs(req, res) {
  res.json({
    logs: dlp.getAuditLogs(),
    ledger: {
      blocks: auditLedger.getEntries().length,
      totalAppended: auditLedger.totalAppended,
      integrity: auditLedger.verifyChainIntegrity()
    },
    totalDetections: dlp.getTotalInterceptions(),
    injectionsBlocked: telemetry.counters.injectionsBlocked
  });
}

export function exportSecurityLogs(req, res) {
  const format = String(req.query.format || 'jsonl').toLowerCase();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="synapse_audit_ledger.csv"');
    return res.send(auditLedger.exportCSV());
  }

  if (format !== 'jsonl') {
    return res.status(400).json({ error: { message: 'Formato no soportado. Usa "jsonl" o "csv".', code: 400 } });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="synapse_audit_ledger.jsonl"');
  res.send(auditLedger.exportJSONL());
}

export function getModels(req, res) {
  res.json({
    models: router.getAvailableModels(),
    pricesReviewedAt: router.catalog._pricesReviewedAt,
    note: router.catalog._pricesReviewedAt
      ? undefined
      : 'Los precios del catálogo no han sido verificados por un operador; los importes de coste son orientativos.'
  });
}

/**
 * GET /healthz — readiness for load balancers and the dashboard banner.
 * Degraded (503) when no real provider can serve traffic.
 */
export function getHealth(req, res) {
  const chain = auditLedger.verifyChainIntegrity();
  const hasProvider = providers.hasRealProvider();

  const body = {
    status: hasProvider && chain.isValid ? 'ok' : 'degraded',
    version: process.env.npm_package_version || '2.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      providers: { ok: hasProvider, detail: providers.status() },
      auditChain: { ok: chain.isValid, detail: chain },
      cache: { ok: true, size: cache.getStats().size },
      mockProviderActive: !hasProvider && providers.isConfigured('mock')
    }
  };

  res.status(body.status === 'ok' ? 200 : 503).json(body);
}

/** GET /api/integrity — file-hash verification against the shipped manifest. */
export function getIntegrity(req, res) {
  res.json(integrity.verifyIntegrity());
}

/**
 * POST /api/extension/event
 *
 * The browser extension reports the *shape* of a detection — rule ids and the
 * user's decision — so an operator can see leak attempts across the team. It
 * deliberately accepts no prompt text: the extension's whole point is that the
 * draft never leaves the page.
 */
export function recordExtensionEvent(req, res) {
  const { host, decision, rules } = req.body ?? {};

  if (!Array.isArray(rules) || !['redact', 'send', 'cancel'].includes(decision)) {
    return res.status(400).json({ error: { message: 'Se esperaba { host, decision, rules[] }.', code: 400 } });
  }

  // Bounded: this endpoint appends to the audit chain, so an unbounded array is
  // a way to inflate the ledger from a browser.
  if (rules.length > 50) {
    return res.status(413).json({ error: { message: 'Demasiadas reglas en un solo evento (máximo 50).', code: 413 } });
  }

  // The decision goes into `source`, which is part of the hashed canonical
  // record. Keeping it only in the application log left the one field with
  // disciplinary weight — "they were warned and sent it anyway" — outside the
  // tamper-evident chain.
  const entry = auditLedger.append({
    source: `extension:${decision}:${String(host).slice(0, 80)}`,
    detectionsCount: rules.length,
    severity: rules.some(r => r.severity === 'critical') ? 'CRITICAL' : 'HIGH',
    items: rules.map(r => ({ name: String(r.id).slice(0, 60) })),
    payloadHash: null
  });

  log.info('Evento de la extensión registrado', { host, decision, rules: rules.length });
  res.status(202).json({ recorded: true, block: entry.index });
}

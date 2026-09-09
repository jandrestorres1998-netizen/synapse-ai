/**
 * Request telemetry.
 *
 * Every counter here is derived from something that actually happened. The
 * previous implementation credited "tokens saved" as 45% of every request's
 * estimated tokens and accumulated a dollar figure from a straw-man baseline,
 * which made the dashboard's headline numbers fiction.
 *
 * The rules now:
 *  - tokensSaved counts only tokens that were genuinely not sent upstream,
 *    i.e. cache hits, using the token count measured on the original call.
 *  - Cost is computed from provider-reported usage. When a provider omits usage
 *    the figure is flagged as an estimate.
 *  - The baseline comparison is reported separately and named as a comparison.
 */
export class Telemetry {
  constructor({ historySize = 100 } = {}) {
    this.historySize = historySize;
    this.reset();
  }

  reset() {
    this.counters = {
      requestsTotal: 0,
      requestsServedByCache: 0,
      requestsSentUpstream: 0,
      requestsBlocked: 0,
      requestsFailed: 0,
      requestsCancelled: 0,
      inputTokensSentUpstream: 0,
      outputTokensReceived: 0,
      tokensAvoidedByCache: 0,
      dlpDetections: 0,
      injectionsBlocked: 0,
      canaryLeaksBlocked: 0
    };

    this.spend = {
      actualUsd: 0,
      baselineComparisonUsd: 0,
      estimatedPortionUsd: 0
    };

    this.latency = { samples: [], p50Ms: null, p95Ms: null };
    this.history = [];
  }

  /**
   * Records a latency sample. Percentiles are computed on read, not here:
   * sorting the whole window on every request put an O(n log n) step on the
   * hot path of a single-threaded process for a number nobody was reading.
   */
  recordLatency(ms) {
    this.latency.samples.push(ms);
    if (this.latency.samples.length > 500) this.latency.samples.shift();
  }

  _percentiles() {
    const sorted = [...this.latency.samples].sort((a, b) => a - b);
    return {
      p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null
    };
  }

  /**
   * @param {Object} entry
   * @param {'cache'|'upstream'|'blocked'|'error'|'cancelled'} entry.outcome
   */
  record(entry) {
    this.counters.requestsTotal++;

    switch (entry.outcome) {
      case 'cache':
        this.counters.requestsServedByCache++;
        this.counters.tokensAvoidedByCache += (entry.usage?.inputTokens ?? 0) + (entry.usage?.outputTokens ?? 0);
        break;
      case 'upstream':
        this.counters.requestsSentUpstream++;
        this.counters.inputTokensSentUpstream += entry.usage?.inputTokens ?? 0;
        this.counters.outputTokensReceived += entry.usage?.outputTokens ?? 0;
        this.spend.actualUsd += entry.cost?.usd ?? 0;
        this.spend.baselineComparisonUsd += entry.comparison?.baselineUsd ?? entry.cost?.usd ?? 0;
        if (entry.cost?.isEstimate) this.spend.estimatedPortionUsd += entry.cost.usd ?? 0;
        break;
      case 'blocked':
        this.counters.requestsBlocked++;
        break;
      case 'cancelled':
        // The client hung up. Counting these as failures made the error rate a
        // measure of user behaviour rather than of gateway health.
        this.counters.requestsCancelled++;
        break;
      case 'error':
        this.counters.requestsFailed++;
        break;
    }

    this.counters.dlpDetections += entry.dlpDetections ?? 0;
    if (entry.injectionBlocked) this.counters.injectionsBlocked++;
    if (entry.canaryLeaked) this.counters.canaryLeaksBlocked++;

    if (Number.isFinite(entry.latencyMs)) this.recordLatency(entry.latencyMs);

    this.history.unshift({
      id: entry.id,
      timestamp: new Date().toISOString(),
      outcome: entry.outcome,
      model: entry.model ?? null,
      provider: entry.provider ?? null,
      latencyMs: entry.latencyMs ?? null,
      inputTokens: entry.usage?.inputTokens ?? null,
      outputTokens: entry.usage?.outputTokens ?? null,
      costUsd: entry.cost?.usd ?? 0,
      costIsEstimate: entry.cost?.isEstimate ?? true,
      dlpMasked: Boolean(entry.dlpDetections),
      tenantId: entry.tenantId ?? null
    });

    if (this.history.length > this.historySize) this.history.pop();
  }

  snapshot() {
    const { requestsTotal, requestsServedByCache } = this.counters;

    return {
      counters: { ...this.counters },
      spend: {
        actualUsd: Number(this.spend.actualUsd.toFixed(6)),
        baselineComparisonUsd: Number(this.spend.baselineComparisonUsd.toFixed(6)),
        differenceUsd: Number((this.spend.baselineComparisonUsd - this.spend.actualUsd).toFixed(6)),
        estimatedPortionUsd: Number(this.spend.estimatedPortionUsd.toFixed(6)),
        note: 'differenceUsd compara el gasto real contra un modelo de referencia configurado. No es dinero ahorrado: asume que todas las peticiones habrían ido a ese modelo.'
      },
      cacheHitRatePercent: requestsTotal > 0 ? Math.round((requestsServedByCache / requestsTotal) * 100) : 0,
      latency: { ...this._percentiles(), samples: this.latency.samples.length },
      history: this.history
    };
  }
}

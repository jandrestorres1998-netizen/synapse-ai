/**
 * Common contract for every upstream model provider.
 *
 * A provider is responsible for one thing only: turning a normalized chat
 * request into a real HTTP call and normalizing the answer back. It performs
 * no DLP, no caching and no routing — those belong to the pipeline.
 */

export class ProviderError extends Error {
  constructor(message, { provider, status = 502, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
    this.cause = cause;
  }
}

export class BaseProvider {
  /**
   * @param {Object} options
   * @param {string} options.name    Registry id, e.g. 'openai'
   * @param {string} options.baseUrl
   * @param {string} options.apiKey
   * @param {number} options.timeoutMs
   */
  constructor({ name, baseUrl, apiKey = '', timeoutMs = 120000 }) {
    this.name = name;
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  /** Providers that need no credential (Ollama, mock) override this. */
  isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * @returns {Promise<{content: string, usage: {inputTokens: number, outputTokens: number}, model: string, finishReason: string}>}
   */
  async chat() {
    throw new Error(`${this.name}: chat() no implementado`);
  }

  /**
   * @returns {AsyncGenerator<{type: 'delta'|'done', text?: string, usage?: Object, model?: string}>}
   */
  async *stream() {
    throw new Error(`${this.name}: stream() no implementado`);
  }

  /**
   * Fetch with a hard timeout, plus propagation of the caller's abort signal.
   *
   * For streams the timeout is an *inactivity* timeout, refreshed on every
   * chunk. Clearing it once the headers arrived meant it only covered the time
   * to first byte: a stream that stalled mid-answer, or one whose client had
   * already hung up, kept running and kept billing tokens.
   *
   * @param {Object} opts
   * @param {AbortSignal} opts.signal   Caller's signal (client disconnected).
   * @param {boolean}     opts.streaming Keep the inactivity timer armed.
   */
  async _fetch(url, init = {}, { signal = null, streaming = false } = {}) {
    const controller = new AbortController();
    let reason = 'timeout';

    let timer = setTimeout(() => { reason = 'timeout'; controller.abort(); }, this.timeoutMs);
    const forwardAbort = () => { reason = 'client'; controller.abort(); };
    signal?.addEventListener('abort', forwardAbort, { once: true });

    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    };

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (streaming) {
        // The generator refreshes this on each chunk and calls done() at the end.
        response._synapseStream = {
          keepAlive: () => {
            clearTimeout(timer);
            timer = setTimeout(() => { reason = 'inactivity'; controller.abort(); }, this.timeoutMs);
          },
          done: finish
        };
      } else {
        finish();
      }

      return response;
    } catch (err) {
      finish();

      if (err.name === 'AbortError') {
        if (reason === 'client') {
          throw new ProviderError(`${this.name}: petición cancelada por el cliente`, {
            provider: this.name, status: 499, retryable: false, cause: err
          });
        }
        throw new ProviderError(`${this.name}: tiempo de espera agotado tras ${this.timeoutMs}ms (${reason})`, {
          provider: this.name, status: 504, retryable: true, cause: err
        });
      }

      throw new ProviderError(`${this.name}: fallo de red — ${err.message}`, {
        provider: this.name, status: 502, retryable: true, cause: err
      });
    }
  }

  async _assertOk(response) {
    if (response.ok) return;

    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch { /* body already consumed or unreadable */ }

    // 408/429/5xx are worth retrying on another provider; 4xx are our fault.
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ProviderError(`${this.name}: HTTP ${response.status} — ${detail}`, {
      provider: this.name, status: response.status, retryable
    });
  }

  /**
   * Reads a `text/event-stream` body and yields each `data:` payload.
   * Shared by every provider that speaks SSE.
   */
  async *_iterateSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const stream = response._synapseStream;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stream?.keepAlive();

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload) yield payload;
          }
        }
      }
    } finally {
      stream?.done();
      // Cancelling the reader propagates back to the socket, so an abandoned
      // stream stops consuming (and billing) instead of running to completion.
      try { await reader.cancel(); } catch { /* already closed */ }
      reader.releaseLock?.();
    }
  }
}

/**
 * Character-count heuristic used only when a provider omits usage data.
 * Flagged as an estimate so telemetry never reports it as measured.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

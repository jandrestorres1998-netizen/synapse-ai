import { BaseProvider, ProviderError, estimateTokens } from './base.js';

/**
 * Ollama provider for on-premise / air-gapped inference.
 * Uses /api/chat, which streams newline-delimited JSON rather than SSE.
 */
export class OllamaProvider extends BaseProvider {
  constructor({ baseUrl = 'http://127.0.0.1:11434', timeoutMs }) {
    super({ name: 'ollama', baseUrl, apiKey: '', timeoutMs });
  }

  /**
   * Local inference needs no credential, but "no credential required" is not
   * the same as "available": reporting Ollama as ready when the daemon is not
   * running makes the health check green while every request fails. Reachability
   * is probed asynchronously and cached; unknown is treated as available so a
   * cold start is not penalised.
   */
  isConfigured() {
    return this.reachable !== false;
  }

  /** Refreshes the cached reachability flag. Safe to call on a timer. */
  async probe() {
    try {
      await this.listModels();
      this.reachable = true;
    } catch {
      this.reachable = false;
    }
    return this.reachable;
  }

  _body({ model, messages, system, maxTokens, temperature, stream }) {
    const payload = [...messages];
    if (system) payload.unshift({ role: 'system', content: system });

    // Only send options the caller actually specified, so Ollama applies the
    // model's own defaults rather than ours.
    const options = {};
    if (temperature !== undefined) options.temperature = temperature;
    if (maxTokens !== undefined) options.num_predict = maxTokens;

    return JSON.stringify({
      model,
      messages: payload,
      stream,
      ...(Object.keys(options).length > 0 ? { options } : {})
    });
  }

  /** Confirms the daemon is reachable and the model is pulled. */
  async listModels() {
    const response = await this._fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
    await this._assertOk(response);
    const data = await response.json();
    return (data.models ?? []).map(m => m.name);
  }

  async chat({ model, messages, system = '', maxTokens, temperature, signal }) {
    const response = await this._fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this._body({ model, messages, system, maxTokens, temperature, stream: false })
    }, { signal });
    await this._assertOk(response);

    const data = await response.json();
    const content = data.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderError('ollama: respuesta sin message.content', { provider: 'ollama', status: 502 });
    }

    return {
      content,
      finishReason: data.done_reason ?? 'stop',
      model: data.model ?? model,
      usage: {
        inputTokens: data.prompt_eval_count ?? estimateTokens(JSON.stringify(messages) + system),
        outputTokens: data.eval_count ?? estimateTokens(content),
        measured: Number.isFinite(data.eval_count)
      }
    };
  }

  async *stream({ model, messages, system = '', maxTokens, temperature, signal }) {
    const response = await this._fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this._body({ model, messages, system, maxTokens, temperature, stream: true })
    }, { signal, streaming: true });
    await this._assertOk(response);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const streamCtl = response._synapseStream;
    let buffer = '';
    let text = '';
    let final = null;
    let resolvedModel = model;

    try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamCtl?.keepAlive();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (event.model) resolvedModel = event.model;
        if (event.done) final = event;

        const delta = event.message?.content;
        if (delta) {
          text += delta;
          yield { type: 'delta', text: delta };
        }
      }
    }
    } finally {
      streamCtl?.done();
      try { await reader.cancel(); } catch { /* already closed */ }
    }

    yield {
      type: 'done',
      model: resolvedModel,
      usage: {
        inputTokens: final?.prompt_eval_count ?? estimateTokens(JSON.stringify(messages) + system),
        outputTokens: final?.eval_count ?? estimateTokens(text),
        measured: Number.isFinite(final?.eval_count)
      }
    };
  }
}

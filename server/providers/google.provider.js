import { BaseProvider, ProviderError, estimateTokens } from './base.js';

/**
 * Google Gemini (Generative Language API) provider.
 * Roles are `user`/`model`, content lives in `parts`, and the system prompt is
 * `systemInstruction`, so the OpenAI-shaped request is translated here.
 */
export class GoogleProvider extends BaseProvider {
  constructor({ apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta', timeoutMs }) {
    super({ name: 'google', baseUrl, apiKey, timeoutMs });
  }

  static toContents(messages, system = '') {
    let systemPrompt = system;
    const contents = [];

    for (const msg of messages) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + text;
        continue;
      }
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: '(sin contenido)' }] });
    }

    return { systemPrompt, contents };
  }

  _body({ contents, systemPrompt, maxTokens, temperature }) {
    return JSON.stringify({
      contents,
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      generationConfig: { maxOutputTokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) }
    });
  }

  static _extractText(candidate) {
    return (candidate?.content?.parts ?? []).map(p => p.text ?? '').join('');
  }

  async chat({ model, messages, system = '', maxTokens = 1024, temperature, signal }) {
    const { systemPrompt, contents } = GoogleProvider.toContents(messages, system);

    const response = await this._fetch(
      `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: this._body({ contents, systemPrompt, maxTokens, temperature })
      },
      { signal }
    );
    await this._assertOk(response);

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate) {
      const blockReason = data.promptFeedback?.blockReason;
      throw new ProviderError(
        blockReason
          ? `google: petición bloqueada por filtros de seguridad (${blockReason})`
          : 'google: respuesta sin candidates',
        { provider: 'google', status: 502 }
      );
    }

    const content = GoogleProvider._extractText(candidate);
    return {
      content,
      finishReason: candidate.finishReason?.toLowerCase() ?? 'stop',
      model: data.modelVersion ?? model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? estimateTokens(JSON.stringify(contents) + systemPrompt),
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? estimateTokens(content),
        measured: Boolean(data.usageMetadata)
      }
    };
  }

  async *stream({ model, messages, system = '', maxTokens = 1024, temperature, signal }) {
    const { systemPrompt, contents } = GoogleProvider.toContents(messages, system);

    const response = await this._fetch(
      `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: this._body({ contents, systemPrompt, maxTokens, temperature })
      },
      { signal, streaming: true }
    );
    await this._assertOk(response);

    let usage = null;
    let resolvedModel = model;
    let text = '';

    for await (const payload of this._iterateSSE(response)) {
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      if (event.modelVersion) resolvedModel = event.modelVersion;
      if (event.usageMetadata) usage = event.usageMetadata;

      const delta = GoogleProvider._extractText(event.candidates?.[0]);
      if (delta) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
    }

    yield {
      type: 'done',
      model: resolvedModel,
      usage: {
        inputTokens: usage?.promptTokenCount ?? estimateTokens(JSON.stringify(contents) + systemPrompt),
        outputTokens: usage?.candidatesTokenCount ?? estimateTokens(text),
        measured: Boolean(usage)
      }
    };
  }
}

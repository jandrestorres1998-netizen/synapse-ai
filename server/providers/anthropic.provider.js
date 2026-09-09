import { BaseProvider, ProviderError, estimateTokens } from './base.js';

/**
 * Anthropic Messages API provider.
 * The system prompt is a top-level field rather than a message role, and
 * consecutive same-role turns are rejected, so both are normalized here.
 */
export class AnthropicProvider extends BaseProvider {
  constructor({ apiKey, baseUrl = 'https://api.anthropic.com/v1', timeoutMs }) {
    super({ name: 'anthropic', baseUrl, apiKey, timeoutMs });
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01'
    };
  }

  /** Extracts system turns and collapses adjacent same-role messages. */
  static normalizeMessages(messages, system = '') {
    let systemPrompt = system;
    const turns = [];

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + content;
        continue;
      }
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      const previous = turns[turns.length - 1];
      if (previous && previous.role === msg.role) {
        previous.content += '\n\n' + content;
      } else {
        turns.push({ role: msg.role, content });
      }
    }

    // The API requires the conversation to open with a user turn.
    if (turns.length === 0 || turns[0].role !== 'user') {
      turns.unshift({ role: 'user', content: '(sin contenido)' });
    }

    return { systemPrompt, turns };
  }

  async chat({ model, messages, system = '', maxTokens = 1024, temperature, signal }) {
    const { systemPrompt, turns } = AnthropicProvider.normalizeMessages(messages, system);

    const response = await this._fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: turns
      })
    }, { signal });
    await this._assertOk(response);

    const data = await response.json();
    if (!Array.isArray(data.content)) {
      throw new ProviderError('anthropic: respuesta sin bloque content', { provider: 'anthropic', status: 502 });
    }

    const content = data.content.filter(c => c.type === 'text').map(c => c.text).join('');
    return {
      content,
      finishReason: data.stop_reason ?? 'stop',
      model: data.model ?? model,
      usage: {
        inputTokens: data.usage?.input_tokens ?? estimateTokens(JSON.stringify(turns) + systemPrompt),
        outputTokens: data.usage?.output_tokens ?? estimateTokens(content),
        measured: Boolean(data.usage)
      }
    };
  }

  async *stream({ model, messages, system = '', maxTokens = 1024, temperature, signal }) {
    const { systemPrompt, turns } = AnthropicProvider.normalizeMessages(messages, system);

    const response = await this._fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        stream: true,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: turns
      })
    }, { signal, streaming: true });
    await this._assertOk(response);

    let inputTokens = 0;
    let outputTokens = 0;
    let resolvedModel = model;
    let text = '';

    for await (const payload of this._iterateSSE(response)) {
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      if (event.type === 'message_start') {
        resolvedModel = event.message?.model ?? resolvedModel;
        inputTokens = event.message?.usage?.input_tokens ?? 0;
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
        yield { type: 'delta', text: event.delta.text };
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      } else if (event.type === 'error') {
        throw new ProviderError(`anthropic: ${event.error?.message ?? 'error de stream'}`, {
          provider: 'anthropic', status: 502, retryable: true
        });
      }
    }

    yield {
      type: 'done',
      model: resolvedModel,
      usage: {
        inputTokens: inputTokens || estimateTokens(JSON.stringify(turns) + systemPrompt),
        outputTokens: outputTokens || estimateTokens(text),
        measured: inputTokens > 0
      }
    };
  }
}

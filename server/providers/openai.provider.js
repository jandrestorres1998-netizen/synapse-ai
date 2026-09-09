import { BaseProvider, ProviderError, estimateTokens } from './base.js';

/**
 * OpenAI Chat Completions provider.
 * Also serves any OpenAI-compatible endpoint (Together, Groq, vLLM, LM Studio)
 * by pointing OPENAI_BASE_URL elsewhere.
 *
 * Sampling parameters and tool definitions are passed through exactly as the
 * client sent them, and omitted when the client omitted them. Substituting a
 * default changed the answer a caller got merely by switching `baseURL`, and
 * reasoning models reject `temperature` and `max_tokens` outright.
 */
export class OpenAIProvider extends BaseProvider {
  constructor({ apiKey, baseUrl = 'https://api.openai.com/v1', timeoutMs }) {
    super({ name: 'openai', baseUrl, apiKey, timeoutMs });
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`
    };
  }

  _body({ model, messages, system, maxTokens, temperature, stream, tools, toolChoice, responseFormat, extra }) {
    const payload = [...messages];
    if (system) payload.unshift({ role: 'system', content: system });

    return JSON.stringify({
      model,
      messages: payload,
      stream,
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(extra ?? {}),
      ...(stream ? { stream_options: { include_usage: true } } : {})
    });
  }

  async chat({ model, messages, system = '', maxTokens, temperature, tools, toolChoice, responseFormat, extra, signal }) {
    const response = await this._fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._headers(),
      body: this._body({ model, messages, system, maxTokens, temperature, stream: false, tools, toolChoice, responseFormat, extra })
    }, { signal });
    await this._assertOk(response);

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError('openai: respuesta sin choices', { provider: 'openai', status: 502 });
    }

    const content = choice.message?.content ?? '';
    return {
      content,
      // Returned verbatim so an agentic client keeps working through the gateway.
      toolCalls: choice.message?.tool_calls ?? null,
      finishReason: choice.finish_reason ?? 'stop',
      model: data.model ?? model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages) + system),
        outputTokens: data.usage?.completion_tokens ?? estimateTokens(content),
        measured: Boolean(data.usage)
      }
    };
  }

  async *stream({ model, messages, system = '', maxTokens, temperature, tools, toolChoice, responseFormat, extra, signal }) {
    const response = await this._fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._headers(),
      body: this._body({ model, messages, system, maxTokens, temperature, stream: true, tools, toolChoice, responseFormat, extra })
    }, { signal, streaming: true });
    await this._assertOk(response);

    let usage = null;
    let resolvedModel = model;
    let text = '';
    let finishReason = 'stop';

    for await (const payload of this._iterateSSE(response)) {
      if (payload === '[DONE]') break;

      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue; // keep-alive comment or partial frame
      }

      if (event.model) resolvedModel = event.model;
      if (event.usage) usage = event.usage;

      const choice = event.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      // Tool-call fragments arrive as their own deltas and are forwarded as-is;
      // reassembling them is the client's job, exactly as with OpenAI directly.
      if (choice?.delta?.tool_calls) {
        yield { type: 'tool_calls', toolCalls: choice.delta.tool_calls };
      }

      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
    }

    yield {
      type: 'done',
      model: resolvedModel,
      finishReason,
      usage: {
        inputTokens: usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages) + system),
        outputTokens: usage?.completion_tokens ?? estimateTokens(text),
        measured: Boolean(usage)
      }
    };
  }
}

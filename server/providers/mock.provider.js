import { BaseProvider, estimateTokens } from './base.js';

/**
 * Offline echo provider for development and CI.
 *
 * It performs no inference. Every response is prefixed so a synthetic answer can
 * never be mistaken for model output in a screenshot, a log or a benchmark, and
 * the registry refuses to load it when NODE_ENV=production.
 */
export class MockProvider extends BaseProvider {
  constructor() {
    super({ name: 'mock', baseUrl: '', apiKey: '', timeoutMs: 1000 });
  }

  isConfigured() {
    return true;
  }

  static _render(messages, system) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const prompt = typeof lastUser?.content === 'string' ? lastUser.content : '';
    return [
      '[RESPUESTA SINTÉTICA — proveedor mock, sin inferencia real]',
      `Prompt recibido (${prompt.length} caracteres): ${prompt.slice(0, 200)}${prompt.length > 200 ? '…' : ''}`,
      system ? `Contexto de sistema aplicado: ${system.length} caracteres.` : 'Sin contexto de sistema.'
    ].join('\n');
  }

  async chat({ model = 'mock-echo', messages = [], system = '' }) {
    const content = MockProvider._render(messages, system);
    return {
      content,
      finishReason: 'stop',
      model,
      usage: {
        inputTokens: estimateTokens(JSON.stringify(messages) + system),
        outputTokens: estimateTokens(content),
        measured: false
      }
    };
  }

  async *stream({ model = 'mock-echo', messages = [], system = '' }) {
    const content = MockProvider._render(messages, system);
    for (const chunk of content.match(/.{1,24}/gs) ?? []) {
      yield { type: 'delta', text: chunk };
    }
    yield {
      type: 'done',
      model,
      usage: {
        inputTokens: estimateTokens(JSON.stringify(messages) + system),
        outputTokens: estimateTokens(content),
        measured: false
      }
    };
  }
}

import { ENV } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { ProviderError } from './base.js';
import { OpenAIProvider } from './openai.provider.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { GoogleProvider } from './google.provider.js';
import { OllamaProvider } from './ollama.provider.js';
import { MockProvider } from './mock.provider.js';

const log = createLogger('Providers');

/**
 * Resolves credentials and hands out provider instances.
 *
 * Credential precedence is vault first, environment second, so an operator can
 * rotate a key through the UI without restarting the process.
 */
export class ProviderRegistry {
  constructor(vault = null, env = ENV) {
    this.vault = vault;
    this.env = env;
    this._instances = new Map();
  }

  _credential(provider) {
    const fromVault = this.vault?.getKey?.(provider);
    if (fromVault) return fromVault;

    return {
      openai: this.env.PROVIDERS.OPENAI_API_KEY,
      anthropic: this.env.PROVIDERS.ANTHROPIC_API_KEY,
      google: this.env.PROVIDERS.GOOGLE_API_KEY
    }[provider] || '';
  }

  /**
   * @param {'openai'|'anthropic'|'google'|'ollama'|'mock'} name
   * @returns {import('./base.js').BaseProvider}
   */
  get(name) {
    const timeoutMs = this.env.PROVIDERS.REQUEST_TIMEOUT_MS;

    switch (name) {
      case 'openai':
        return new OpenAIProvider({
          apiKey: this._credential('openai'),
          baseUrl: this.env.PROVIDERS.OPENAI_BASE_URL,
          timeoutMs
        });
      case 'anthropic':
        return new AnthropicProvider({
          apiKey: this._credential('anthropic'),
          baseUrl: this.env.PROVIDERS.ANTHROPIC_BASE_URL,
          timeoutMs
        });
      case 'google':
        return new GoogleProvider({
          apiKey: this._credential('google'),
          baseUrl: this.env.PROVIDERS.GOOGLE_BASE_URL,
          timeoutMs
        });
      case 'ollama':
        // Stateless and cheap to construct, but cached to reuse keep-alive.
        if (!this._instances.has('ollama')) {
          this._instances.set('ollama', new OllamaProvider({
            baseUrl: this.env.PROVIDERS.OLLAMA_BASE_URL,
            timeoutMs
          }));
        }
        return this._instances.get('ollama');
      case 'mock':
        if (!this.env.ALLOW_MOCK_PROVIDER) {
          throw new ProviderError(
            'El proveedor mock está deshabilitado. Configura una clave real o activa SYNAPSE_ALLOW_MOCK_PROVIDER fuera de producción.',
            { provider: 'mock', status: 503 }
          );
        }
        if (!this._instances.has('mock')) this._instances.set('mock', new MockProvider());
        return this._instances.get('mock');
      default:
        throw new ProviderError(`Proveedor desconocido: ${name}`, { provider: name, status: 400 });
    }
  }

  isConfigured(name) {
    try {
      return this.get(name).isConfigured();
    } catch {
      return false;
    }
  }

  /** Names of providers that can actually serve traffic right now. */
  availableProviders() {
    return ['openai', 'anthropic', 'google', 'ollama', 'mock'].filter(name => this.isConfigured(name));
  }

  /** Status snapshot for the dashboard and /healthz — never exposes key material. */
  status() {
    const detail = {};
    for (const name of ['openai', 'anthropic', 'google', 'ollama', 'mock']) {
      let configured = false;
      let source = 'none';
      try {
        const provider = this.get(name);
        configured = provider.isConfigured();
        if (configured) {
          if (name === 'ollama' || name === 'mock') source = 'local';
          else source = this.vault?.getKey?.(name) ? 'vault' : 'env';
        }
      } catch {
        configured = false;
        source = 'disabled';
      }
      detail[name] = { configured, source };
    }
    return detail;
  }

  /** True when no real upstream is reachable — the dashboard warns on this. */
  hasRealProvider() {
    return ['openai', 'anthropic', 'google', 'ollama'].some(name => this.isConfigured(name));
  }
}

export { ProviderError };

/**
 * Probes providers whose availability cannot be inferred from configuration
 * alone, and keeps the result fresh. Returns a stop function.
 */
export function startProviderProbes(registry, intervalMs = 60_000) {
  const probe = () => registry.get('ollama').probe().catch(() => {});
  probe();
  const timer = setInterval(probe, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function logProviderStartupState(registry) {
  const status = registry.status();
  const configured = Object.entries(status).filter(([, v]) => v.configured).map(([k]) => k);

  if (configured.length === 0) {
    log.error('Ningún proveedor configurado. El gateway rechazará toda petición de inferencia.');
  } else {
    log.info('Proveedores disponibles', { configured, detail: status });
  }

  if (!registry.hasRealProvider() && registry.isConfigured('mock')) {
    log.warn('Solo el proveedor mock está activo: las respuestas son sintéticas, no inferencia real.');
  }
}

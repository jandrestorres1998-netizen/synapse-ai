import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, 'config/models.json');
const log = createLogger('SmartRouter');

/**
 * Routes a request to a model tier, then to a model that is actually reachable.
 *
 * Two deliberate constraints:
 *  - It never selects a provider without credentials; an unreachable "cheapest"
 *    model is worse than a reachable expensive one.
 *  - Cost figures are a *counterfactual comparison* against a configured
 *    baseline model, not money that was ever going to be spent. They are
 *    labelled as such everywhere they surface.
 */
export class SmartRouter {
  constructor(registry, { catalogPath = CATALOG_PATH } = {}) {
    this.registry = registry;
    this.catalog = SmartRouter.loadCatalog(catalogPath);
    this.models = new Map(this.catalog.models.map(m => [m.id, m]));
    this.routing = this.catalog.routing;

    if (!this.catalog._pricesReviewedAt) {
      log.warn('El catálogo de precios no ha sido revisado por un operador; los importes de coste son estimaciones sin verificar.', {
        catalogPath
      });
    }
  }

  static loadCatalog(catalogPath) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (!Array.isArray(catalog.models) || catalog.models.length === 0) {
      throw new Error(`Catálogo de modelos vacío o inválido: ${catalogPath}`);
    }
    return catalog;
  }

  /** Rough token estimate for routing decisions only — never billed on. */
  static estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  static COMPLEXITY_PATTERNS = [
    /\b(refactor|refactoriza|arquitectura|architecture|race condition|deadlock|concurrencia|memory leak|algoritmo|algorithm|demuestra|theorem)\b/i,
    /\b(análisis de contrato|contract analysis|responsabilidad legal|legal liability|valoración financiera|auditoría|soc ?2|gdpr|hipaa)\b/i,
    /\b(paso a paso|multi-step|chain of thought|razonamiento profundo|deep reasoning|escribe una aplicación|build an entire)\b/i
  ];

  classify(prompt, options = {}) {
    const text = prompt || '';
    const tokens = SmartRouter.estimateTokens(text);
    const threshold = this.routing.complexityTokenThreshold ?? 3000;

    const matchedPattern = SmartRouter.COMPLEXITY_PATTERNS.find(rx => rx.test(text));
    const isComplex = Boolean(matchedPattern) || tokens > threshold;

    let tier = isComplex ? 'deep' : this.routing.defaultTier;
    let reason = isComplex
      ? (matchedPattern ? 'Patrón de alta complejidad detectado en el prompt.' : `Contexto largo (${tokens} tokens estimados > ${threshold}).`)
      : 'Consulta breve o conversacional.';

    // An explicit privacy requirement outranks cost and latency.
    if (options.forceLocal || options.requiresLocal) {
      tier = 'local';
      reason = 'Ejecución local exigida por la política de la petición (datos que no deben salir del perímetro).';
    }

    return { tier, isComplex, estimatedTokens: tokens, reason };
  }

  /** Cheapest reachable model in a tier, falling back through adjacent tiers. */
  _selectModel(tier) {
    const order = {
      local: ['local', 'fast', 'balanced', 'deep'],
      fast: ['fast', 'balanced', 'deep'],
      balanced: ['balanced', 'fast', 'deep'],
      deep: ['deep', 'balanced', 'fast']
    }[tier] ?? ['fast', 'balanced', 'deep'];

    for (const candidateTier of order) {
      const candidates = this.catalog.models
        .filter(m => m.tier === candidateTier && m.provider !== 'mock')
        .filter(m => this.registry.isConfigured(m.provider))
        .sort((a, b) => (a.pricePer1M.input + a.pricePer1M.output) - (b.pricePer1M.input + b.pricePer1M.output));

      if (candidates.length > 0) {
        return { model: candidates[0], degradedFrom: candidateTier === tier ? null : tier };
      }
    }

    // Last resort: the mock provider, only if the operator explicitly allowed it.
    const mock = this.models.get('mock');
    if (mock && this.registry.isConfigured('mock')) {
      return { model: mock, degradedFrom: tier };
    }

    return { model: null, degradedFrom: tier };
  }

  /**
   * @returns {{selectedModel, tier, reasoning, estimatedTokens, costComparison, isComplex, degradedFrom}}
   */
  route(prompt, options = {}) {
    const classification = this.classify(prompt, options);

    // An explicit model request is honoured when that provider is reachable.
    if (options.preferredModel && this.models.has(options.preferredModel)) {
      const preferred = this.models.get(options.preferredModel);
      if (this.registry.isConfigured(preferred.provider)) {
        return this._buildDecision(preferred, classification, 'Modelo solicitado explícitamente por el cliente.', null);
      }
      log.warn('Modelo preferido no disponible, se aplica enrutamiento automático', { requested: options.preferredModel });
    }

    const { model, degradedFrom } = this._selectModel(classification.tier);
    if (!model) {
      const error = new Error('Ningún proveedor de modelos está configurado. Configura una clave en el vault o en las variables de entorno.');
      error.status = 503;
      error.code = 'NO_PROVIDER_CONFIGURED';
      throw error;
    }

    const reasoning = degradedFrom
      ? `${classification.reason} Nivel "${degradedFrom}" sin proveedor disponible; se degradó a "${model.tier}".`
      : classification.reason;

    return this._buildDecision(model, classification, reasoning, degradedFrom);
  }

  _buildDecision(model, classification, reasoning, degradedFrom) {
    return {
      selectedModel: model,
      tier: model.tier,
      reasoning,
      estimatedTokens: classification.estimatedTokens,
      isComplex: classification.isComplex,
      degradedFrom
    };
  }

  /**
   * Upper bound on what a call could cost, for booking against a budget before
   * it runs. Output length is not knowable in advance, so the cap the caller
   * asked for is assumed to be reached — the point of a spend control is to be
   * wrong in the safe direction.
   */
  estimateMaxCost(modelId, promptText, maxTokens = 1024) {
    const model = this.models.get(modelId);
    if (!model) return 0;

    const inputTokens = SmartRouter.estimateTokens(promptText);
    const usd = (inputTokens / 1_000_000) * model.pricePer1M.input
      + (maxTokens / 1_000_000) * model.pricePer1M.output;

    return Number(usd.toFixed(6));
  }

  /** Actual spend for a completed call, from provider-reported usage. */
  computeCost(modelId, usage) {
    const model = this.models.get(modelId);
    if (!model) return { usd: 0, isEstimate: true };

    const usd = (usage.inputTokens / 1_000_000) * model.pricePer1M.input
      + (usage.outputTokens / 1_000_000) * model.pricePer1M.output;

    return {
      usd: Number(usd.toFixed(6)),
      // Only "measured" when the provider itself reported the token counts.
      isEstimate: !usage.measured
    };
  }

  /**
   * What the same call would have cost on the baseline model.
   * This is a comparison, not a saving: most teams would never have sent every
   * request to the flagship model in the first place.
   */
  compareToBaseline(modelId, usage) {
    const baselineId = this.routing.comparisonBaselineModelId;
    const baseline = this.models.get(baselineId);
    const actual = this.computeCost(modelId, usage);

    if (!baseline || modelId === baselineId) {
      return { baselineModelId: baselineId, baselineUsd: actual.usd, actualUsd: actual.usd, deltaUsd: 0, isEstimate: actual.isEstimate };
    }

    const baselineUsd = (usage.inputTokens / 1_000_000) * baseline.pricePer1M.input
      + (usage.outputTokens / 1_000_000) * baseline.pricePer1M.output;

    return {
      baselineModelId: baselineId,
      baselineUsd: Number(baselineUsd.toFixed(6)),
      actualUsd: actual.usd,
      deltaUsd: Number((baselineUsd - actual.usd).toFixed(6)),
      isEstimate: actual.isEstimate,
      note: 'Comparación contra un modelo de referencia configurado; no representa gasto evitado real.'
    };
  }

  getAvailableModels() {
    return this.catalog.models.map(m => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      providerModel: m.providerModel,
      tier: m.tier,
      contextWindow: m.contextWindow,
      pricePer1M: m.pricePer1M,
      available: this.registry.isConfigured(m.provider)
    }));
  }

  getModel(id) {
    return this.models.get(id) ?? null;
  }
}

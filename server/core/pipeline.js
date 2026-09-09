import crypto from 'crypto';
import { createLogger } from '../config/logger.js';
import { ProviderError } from '../providers/index.js';
import { StreamRedactor } from './stream-redactor.js';
import { InFlightRegistry } from './inflight.js';
import { BudgetExceededError } from './budget.js';

const log = createLogger('Pipeline');

export class BlockedRequestError extends Error {
  constructor(message, { stage, details = {} } = {}) {
    super(message);
    this.name = 'BlockedRequestError';
    this.status = 403;
    this.stage = stage;
    this.details = details;
  }
}

/**
 * The request pipeline: inspect, route, call a real model, inspect the answer.
 *
 * Order matters and is deliberate:
 *   1. Injection screening runs on the raw text — masking first would hide the
 *      very tokens the screen looks for.
 *   2. DLP redaction runs before anything leaves the process, including before
 *      the cache key is computed, so a secret never becomes a cache lookup.
 *   3. Cache lookup happens after redaction and is scoped to (tenant, model,
 *      system context), so one tenant can never be served another's answer.
 *   4. Upstream call is real. If no provider is configured the request fails
 *      with 503 — it never falls back to synthetic text pretending to be a model.
 */
export class GatewayPipeline {
  constructor({ dlp, router, cache, memory, providers, injectionShield, auditLedger, telemetry, budget, env }) {
    this.dlp = dlp;
    this.router = router;
    this.cache = cache;
    this.memory = memory;
    this.providers = providers;
    this.injectionShield = injectionShield;
    this.auditLedger = auditLedger;
    this.telemetry = telemetry;
    this.budget = budget;
    this.env = env;
    this.inflight = new InFlightRegistry();
  }

  static _requestId() {
    return 'req_' + crypto.randomBytes(6).toString('hex');
  }

  /** Stages 1–3: everything that happens before an upstream call. */
  _prepare(messages, options) {
    const tenantId = options.tenantId || 'default';
    const sessionId = options.sessionId || tenantId;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const rawPrompt = typeof lastUser?.content === 'string' ? lastUser.content : '';

    // 1. Prompt injection screening, on every user turn rather than only the
    //    last one. Inspecting just the newest message let an attacker plant the
    //    jailbreak in the conversation history, where the model still reads it
    //    but the filter never looked.
    const inspectable = messages
      .filter(m => m.role === 'user' && typeof m.content === 'string')
      .map(m => m.content)
      .join('\n');
    const injection = this.injectionShield.inspectIngress(inspectable);
    if (injection.isJailbreakDetected) {
      this.auditLedger.append({
        source: options.source || 'gateway',
        detectionsCount: injection.violations.length,
        severity: 'CRITICAL',
        items: injection.violations,
        payloadHash: this.dlp.fingerprint(rawPrompt)
      });

      throw new BlockedRequestError(
        'Petición bloqueada: se detectó un intento de manipulación de instrucciones del sistema.',
        { stage: 'prompt_injection', details: { threatScore: injection.threatScore, violations: injection.violations } }
      );
    }

    // 2. DLP on every message, not just the last one — history carries secrets too.
    const sanitizedMessages = [];
    const detections = [];
    let obfuscationDetected = false;

    for (const message of messages) {
      if (typeof message.content !== 'string') {
        sanitizedMessages.push(message);
        continue;
      }
      const result = this.dlp.process(message.content, options.source || 'gateway ingress');
      if (result.wasMasked) detections.push(...result.detections);
      if (result.requiresBlock) obfuscationDetected = true;
      sanitizedMessages.push({ ...message, content: result.sanitizedText });
    }

    if (detections.length > 0) {
      this.auditLedger.append({
        source: options.source || 'gateway',
        detectionsCount: detections.length,
        severity: detections.some(d => d.severity === 'CRITICAL') ? 'CRITICAL' : 'HIGH',
        items: detections,
        payloadHash: this.dlp.fingerprint(rawPrompt)
      });

      // A secret that only becomes visible after deobfuscation cannot be masked
      // in place: the span does not exist in the text the user wrote. Forwarding
      // the original would leak it and forwarding the normalized copy would
      // rewrite the request, so the only correct answer is to refuse — whatever
      // the configured DLP mode says.
      if (obfuscationDetected) {
        throw new BlockedRequestError(
          'Petición bloqueada: se detectó un dato sensible oculto mediante ofuscación (codificación, homoglifos o caracteres invisibles). Envíalo en claro para que pueda enmascararse, o retíralo.',
          { stage: 'dlp_obfuscation', details: { detections } }
        );
      }

      if (this.env.DLP.ON_DETECTION === 'block') {
        throw new BlockedRequestError(
          `Petición bloqueada: se detectaron ${detections.length} elemento(s) sensible(s) y la política DLP está en modo "block".`,
          { stage: 'dlp_ingress', details: { detections } }
        );
      }
    }

    // 3. Corporate context becomes the system prompt, plus a canary that lets
    //    egress detect the model echoing its own instructions back.
    const memoryContext = this.memory.getActiveContext();
    const canary = this.injectionShield.generateCanary(sessionId);
    const systemPrompt = memoryContext ? `${memoryContext}\n\n[ref:${canary}]` : '';

    const sanitizedPrompt = sanitizedMessages.filter(m => m.role === 'user').pop()?.content ?? '';

    return { tenantId, sessionId, sanitizedMessages, sanitizedPrompt, systemPrompt, memoryContext, detections };
  }

  /**
   * Books the worst case against the budget, or refuses.
   * @returns {string|null} reservation id, or null when no ledger is wired.
   */
  _reserveBudget(modelId, promptText, options, tenantId) {
    if (!this.budget) return null;

    const estimate = this.router.estimateMaxCost(modelId, promptText, options.maxTokens ?? 1024);
    const decision = this.budget.reserve(tenantId, estimate);

    if (!decision.allowed) {
      log.warn('Petición rechazada por límite de gasto', { tenantId, scope: decision.scope, estimate });
      throw new BudgetExceededError(decision);
    }

    return decision.reservationId;
  }

  /** Runs the upstream call, retrying once on a different provider if allowed. */
  async _callUpstream(decision, { messages, systemPrompt, ...rest }) {
    const model = decision.selectedModel;
    const provider = this.providers.get(model.provider);

    try {
      return await provider.chat({ model: model.providerModel, messages, system: systemPrompt, ...rest });
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable) throw err;

      // Failover is only useful if a *different* reachable provider exists.
      const alternative = this.router.getAvailableModels()
        .find(m => m.available && m.provider !== model.provider && m.provider !== 'mock' && m.tier === model.tier);

      if (!alternative) throw err;

      log.warn('Proveedor primario falló; se reintenta en otro proveedor', {
        from: model.provider, to: alternative.provider, error: err.message
      });

      const fallback = this.providers.get(alternative.provider);
      const result = await fallback.chat({ model: alternative.providerModel, messages, system: systemPrompt, ...rest });

      return { ...result, _failedOverFrom: model.id, _modelId: alternative.id };
    }
  }

  /**
   * Non-streaming execution, with identical concurrent requests coalesced onto
   * a single upstream call. Without this, N simultaneous copies of the same
   * prompt all miss the cache and all get billed.
   *
   * Requests carrying tools are never coalesced: the caller's tool definitions
   * are part of the semantics and are not in the cache key.
   * @returns {Promise<Object>}
   */
  /**
   * Key covering everything that can change the answer.
   *
   * An earlier version keyed on the last user message alone. Two different
   * conversations that happened to end with the same turn — "¿qué opinas?" —
   * were merged, and the second caller received the answer generated from the
   * first caller's history. That is the same class of defect as serving one
   * tenant's cached answer to another, reached through a different door.
   */
  static coalescingKey(messages, options) {
    return crypto.createHash('sha256').update(JSON.stringify({
      tenant: options.tenantId || 'default',
      model: options.preferredModel || 'auto',
      forceLocal: Boolean(options.forceLocal),
      maxTokens: options.maxTokens ?? null,
      temperature: options.temperature ?? null,
      responseFormat: options.responseFormat ?? null,
      messages
    })).digest('hex');
  }

  async execute(messages, options = {}) {
    // Tool definitions are part of the semantics and are not in the key.
    if (options.tools) return this._execute(messages, options);

    const key = GatewayPipeline.coalescingKey(messages, options);
    const result = await this.inflight.run(key, () => this._execute(messages, options));

    // Waiters share the upstream answer but must not share a request id, or the
    // audit trail shows a single identifier for what were several client calls.
    return { ...result, requestId: GatewayPipeline._requestId() };
  }

  /** @returns {Promise<Object>} Normalized result for the controller to shape. */
  async _execute(messages, options = {}) {
    const requestId = GatewayPipeline._requestId();
    const startedAt = Date.now();

    const prepared = this._prepare(messages, options);
    const { tenantId, sessionId, sanitizedMessages, sanitizedPrompt, systemPrompt, memoryContext, detections } = prepared;

    const decision = this.router.route(sanitizedPrompt, options);
    const modelId = decision.selectedModel.id;

    // 4. Cache lookup, scoped so a hit can only ever be this tenant's own answer.
    const cached = this.cache.get({
      prompt: sanitizedPrompt,
      systemContext: memoryContext,
      tenantId,
      model: modelId
    });

    if (cached.isHit) {
      const latencyMs = Date.now() - startedAt;
      this.telemetry.record({
        id: requestId, outcome: 'cache', model: modelId, provider: 'cache',
        latencyMs, usage: cached.usage, dlpDetections: detections.length, tenantId
      });

      return {
        requestId,
        status: 'success',
        source: 'cache',
        matchType: cached.matchType,
        similarity: cached.similarity,
        response: cached.response,
        model: { id: modelId, label: decision.selectedModel.label, provider: 'cache' },
        latencyMs,
        usage: cached.usage,
        cost: { usd: 0, isEstimate: false, note: 'Servido desde caché: no se consumieron tokens del proveedor.' },
        dlp: { ingressDetections: detections, egressDetections: [] },
        context: { applied: Boolean(memoryContext), chars: memoryContext ? memoryContext.length : 0 },
        cachedAt: cached.cachedAt
      };
    }

    // 5. Book the worst-case cost against the budget before spending anything.
    //    A cache hit never reaches here, so cached answers are always free.
    const reservation = this._reserveBudget(modelId, sanitizedPrompt, options, tenantId);

    // 6. Real upstream inference.
    let upstream;
    try {
      upstream = await this._callUpstream(decision, {
        messages: sanitizedMessages,
        systemPrompt,
        // Passed through untouched. Injecting defaults changed the answer a
        // client got merely by pointing at the gateway: OpenAI does not cap
        // max_tokens and defaults temperature to 1.0, and reasoning models
        // reject both parameters outright.
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
        signal: options.signal
      });
    } catch (err) {
      // The call never produced tokens, so it must not hold budget.
      this.budget?.release(reservation);

      // 499 is our own marker for "the client went away", not an upstream fault.
      const outcome = err.status === 499 ? 'cancelled' : 'error';
      this.telemetry.record({ id: requestId, outcome, model: modelId, latencyMs: Date.now() - startedAt, tenantId });
      throw err;
    }

    const effectiveModelId = upstream._modelId ?? modelId;

    // 6. Egress: canary leak check, then DLP on the model's own output.
    const canaryCheck = this.injectionShield.inspectEgress(upstream.content, sessionId);
    const egress = this.dlp.process(canaryCheck.sanitizedResponse, 'LLM egress');

    if (egress.wasMasked) {
      this.auditLedger.append({
        source: 'LLM egress',
        detectionsCount: egress.detections.length,
        severity: 'HIGH',
        items: egress.detections,
        payloadHash: this.dlp.fingerprint(upstream.content)
      });
    }

    // 7. Cache the redacted answer, never the raw one.
    this.cache.set({
      prompt: sanitizedPrompt,
      systemContext: memoryContext,
      tenantId,
      model: effectiveModelId,
      response: egress.sanitizedText,
      usage: upstream.usage
    });

    const latencyMs = Date.now() - startedAt;
    const cost = this.router.computeCost(effectiveModelId, upstream.usage);
    const comparison = this.router.compareToBaseline(effectiveModelId, upstream.usage);

    // Replace the worst-case booking with what it actually cost.
    this.budget?.settle(reservation, cost.usd);

    this.telemetry.record({
      id: requestId, outcome: 'upstream', model: effectiveModelId,
      provider: decision.selectedModel.provider, latencyMs, usage: upstream.usage,
      cost, comparison, dlpDetections: detections.length + egress.detections.length,
      canaryLeaked: canaryCheck.isCanaryLeaked, tenantId
    });

    return {
      requestId,
      status: 'success',
      source: 'upstream',
      response: egress.sanitizedText,
      // Forwarded verbatim so an agentic client keeps its tool loop working.
      toolCalls: upstream.toolCalls ?? null,
      model: {
        id: effectiveModelId,
        label: decision.selectedModel.label,
        provider: decision.selectedModel.provider,
        providerModel: upstream.model
      },
      routing: {
        tier: decision.tier,
        reasoning: decision.reasoning,
        degradedFrom: decision.degradedFrom,
        failedOverFrom: upstream._failedOverFrom ?? null
      },
      latencyMs,
      usage: upstream.usage,
      cost,
      comparison,
      dlp: { ingressDetections: detections, egressDetections: egress.detections, canaryLeaked: canaryCheck.isCanaryLeaked },
      context: { applied: Boolean(memoryContext), chars: memoryContext ? memoryContext.length : 0 },
      finishReason: upstream.finishReason
    };
  }

  /**
   * Streaming execution. Yields `{type:'delta'|'done'|'meta'}` events with
   * egress redaction applied through a tail-buffering redactor.
   */
  async *executeStream(messages, options = {}) {
    const requestId = GatewayPipeline._requestId();
    const startedAt = Date.now();

    const prepared = this._prepare(messages, options);
    const { tenantId, sessionId, sanitizedMessages, sanitizedPrompt, systemPrompt, memoryContext, detections } = prepared;

    const decision = this.router.route(sanitizedPrompt, options);
    const modelId = decision.selectedModel.id;

    const cached = this.cache.get({ prompt: sanitizedPrompt, systemContext: memoryContext, tenantId, model: modelId });
    if (cached.isHit) {
      const latencyMs = Date.now() - startedAt;
      this.telemetry.record({
        id: requestId, outcome: 'cache', model: modelId, provider: 'cache',
        latencyMs, usage: cached.usage, dlpDetections: detections.length, tenantId
      });

      yield { type: 'meta', requestId, source: 'cache', model: modelId };
      yield { type: 'delta', text: cached.response };
      yield { type: 'done', usage: cached.usage, latencyMs, cost: { usd: 0, isEstimate: false } };
      return;
    }

    const model = decision.selectedModel;
    const provider = this.providers.get(model.provider);
    const redactor = new StreamRedactor(this.dlp);

    // Same two-step booking as the non-streaming path.
    const reservation = this._reserveBudget(modelId, sanitizedPrompt, options, tenantId);

    yield { type: 'meta', requestId, source: 'upstream', model: model.id, provider: model.provider };

    let usage = { inputTokens: 0, outputTokens: 0, measured: false };
    let rawText = '';      // what the model produced, used only for the canary check
    let emittedText = '';  // what the client actually received, after redaction

    try {
      for await (const event of provider.stream({
        model: model.providerModel,
        messages: sanitizedMessages,
        system: systemPrompt,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        signal: options.signal
      })) {
        if (event.type === 'delta') {
          rawText += event.text;
          const safe = redactor.push(event.text);
          if (safe) {
            emittedText += safe;
            yield { type: 'delta', text: safe };
          }
        } else if (event.type === 'done') {
          usage = event.usage ?? usage;
        }
      }
    } catch (err) {
      // 499 is our own marker for "the client went away", not an upstream fault.
      const outcome = err.status === 499 ? 'cancelled' : 'error';
      this.telemetry.record({ id: requestId, outcome, model: modelId, latencyMs: Date.now() - startedAt, tenantId });
      throw err;
    }

    const tail = redactor.flush();
    if (tail) {
      emittedText += tail;
      yield { type: 'delta', text: tail };
    }

    // The canary check needs the whole answer, so it runs at the end. A leak
    // detected here cannot un-send the stream — it is recorded and reported.
    const canaryCheck = this.injectionShield.inspectEgress(rawText, sessionId);
    const latencyMs = Date.now() - startedAt;
    const cost = this.router.computeCost(modelId, usage);
    const comparison = this.router.compareToBaseline(modelId, usage);

    this.budget?.settle(reservation, cost.usd);

    if (redactor.wasMasked) {
      this.auditLedger.append({
        source: 'LLM egress (stream)',
        detectionsCount: redactor.detections.length,
        severity: 'HIGH',
        items: redactor.detections,
        payloadHash: this.dlp.fingerprint(rawText)
      });
    }

    // The redacted text is what gets cached. Storing the raw model output here
    // made the egress filter self-defeating: the first caller saw the secret
    // masked, and every later caller was served the unmasked original straight
    // from cache.
    this.cache.set({
      prompt: sanitizedPrompt, systemContext: memoryContext, tenantId,
      model: modelId, response: emittedText, usage
    });

    this.telemetry.record({
      id: requestId, outcome: 'upstream', model: modelId, provider: model.provider,
      latencyMs, usage, cost, comparison,
      dlpDetections: detections.length + redactor.detections.length,
      canaryLeaked: canaryCheck.isCanaryLeaked, tenantId
    });

    yield {
      type: 'done',
      usage,
      latencyMs,
      cost,
      comparison,
      egressRedacted: redactor.wasMasked,
      canaryLeaked: canaryCheck.isCanaryLeaked
    };
  }
}

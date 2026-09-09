import { GatewayPipeline, BlockedRequestError } from '../core/pipeline.js';
import { dlp, router, cache, memory, providers, injectionShield, auditLedger, telemetry, budget, env } from '../config/container.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Gateway');

export const pipeline = new GatewayPipeline({
  dlp, router, cache, memory, providers, injectionShield, auditLedger, telemetry, budget, env
});

function requestOptions(req, source) {
  // Aborted when the client hangs up, so the upstream call is cancelled instead
  // of running to completion and billing tokens nobody will read.
  const abort = new AbortController();
  req.res.on('close', () => { if (!req.res.writableEnded) abort.abort(); });

  return {
    source,
    tenantId: req.auth?.tenantId ?? 'default',
    sessionId: req.get('x-synapse-session') || req.auth?.tenantId || 'default',
    preferredModel: req.body.synapse_model || undefined,
    forceLocal: req.body.synapse_force_local === true,
    // Forwarded only when present: the gateway must not silently change the
    // sampling behaviour a client would have got from the provider directly.
    maxTokens: Number.isFinite(req.body.max_tokens) ? req.body.max_tokens : undefined,
    temperature: Number.isFinite(req.body.temperature) ? req.body.temperature : undefined,
    tools: Array.isArray(req.body.tools) ? req.body.tools : undefined,
    toolChoice: req.body.tool_choice,
    responseFormat: req.body.response_format,
    signal: abort.signal
  };
}

/**
 * POST /v1/chat/completions — OpenAI-compatible surface.
 *
 * The response is a real completion from a real provider. When streaming is
 * requested the upstream stream is relayed chunk by chunk; it is not a complete
 * answer chopped up after the fact, which is what the previous implementation
 * did while advertising streaming latency.
 */
export async function handleOpenAIChatCompletions(req, res, next) {
  const { messages, stream = false } = req.body;

  try {
    if (!stream) {
      const result = await pipeline.execute(messages, requestOptions(req, 'openai_sdk'));

      return res.json({
        id: 'chatcmpl-' + result.requestId.slice(4),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model.providerModel ?? result.model.id,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.response,
            ...(result.toolCalls ? { tool_calls: result.toolCalls } : {})
          },
          finish_reason: result.finishReason ?? 'stop'
        }],
        usage: {
          prompt_tokens: result.usage?.inputTokens ?? 0,
          completion_tokens: result.usage?.outputTokens ?? 0,
          total_tokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0)
        },
        _synapse: {
          source: result.source,
          routing: result.routing ?? null,
          costUsd: result.cost?.usd ?? 0,
          costIsEstimate: result.cost?.isEstimate ?? true,
          dlpIngressDetections: result.dlp.ingressDetections.length,
          dlpEgressDetections: result.dlp.egressDetections.length,
          latencyMs: result.latencyMs
        }
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let streamId = 'chatcmpl-pending';
    let modelName = 'unknown';
    let firstChunk = true;
    // Watch the response, not the request: `req` emits 'close' as soon as the
    // body has been fully read, which is immediately for a normal POST.
    let aborted = false;
    res.on('close', () => { if (!res.writableEnded) aborted = true; });

    const write = chunk => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

    for await (const event of pipeline.executeStream(messages, requestOptions(req, 'openai_sdk_stream'))) {
      if (aborted) break;

      if (event.type === 'meta') {
        streamId = 'chatcmpl-' + event.requestId.slice(4);
        modelName = event.model;
        continue;
      }

      if (event.type === 'delta') {
        write({
          id: streamId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          // OpenAI sends `role` on the first chunk only; clients rely on it to
          // open the assistant message.
          choices: [{
            index: 0,
            delta: firstChunk ? { role: 'assistant', content: event.text } : { content: event.text },
            finish_reason: null
          }]
        });
        firstChunk = false;
        continue;
      }

      if (event.type === 'tool_calls') {
        write({
          id: streamId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{
            index: 0,
            delta: firstChunk ? { role: 'assistant', tool_calls: event.toolCalls } : { tool_calls: event.toolCalls },
            finish_reason: null
          }]
        });
        firstChunk = false;
        continue;
      }

      if (event.type === 'done') {
        write({
          id: streamId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: event.usage?.inputTokens ?? 0,
            completion_tokens: event.usage?.outputTokens ?? 0,
            total_tokens: (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0)
          },
          _synapse: { costUsd: event.cost?.usd ?? 0, latencyMs: event.latencyMs, egressRedacted: event.egressRedacted }
        });
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    // Once SSE headers are out, an error can only be reported inside the stream.
    if (res.headersSent) {
      log.error('Fallo durante el streaming', { error: error.message });
      res.write(`data: ${JSON.stringify({ error: { message: error.message, type: error.name } })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    next(error);
  }
}

/**
 * POST /api/gateway/process — dashboard playground.
 * Returns the full pipeline detail rather than an OpenAI-shaped envelope.
 */
export async function handleGatewayProcess(req, res, next) {
  try {
    const { prompt, messages } = req.body;
    const conversation = Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: prompt }];

    const result = await pipeline.execute(conversation, requestOptions(req, req.body.source || 'dashboard'));
    res.json(result);
  } catch (error) {
    if (error instanceof BlockedRequestError) {
      return res.status(403).json({
        status: 'blocked',
        stage: error.stage,
        message: error.message,
        details: error.details
      });
    }
    next(error);
  }
}

/**
 * Request payload validation.
 *
 * Bounds are enforced here rather than in controllers so an oversized or
 * malformed body is rejected before it reaches the DLP scanner, the cache or a
 * paid upstream call.
 */

const MAX_PROMPT_CHARS = 100_000;
const MAX_MESSAGES = 200;

function reject(res, message, code = 400, type = 'ValidationError') {
  return res.status(code).json({ error: { message, type, code } });
}

/** POST /api/gateway/process */
export function validateGatewayInput(req, res, next) {
  const { prompt, messages } = req.body ?? {};

  if (Array.isArray(messages)) return validateMessages(messages, res, next);

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return reject(res, 'El campo "prompt" es requerido y debe ser un string no vacío.');
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return reject(res, `El prompt excede el límite de ${MAX_PROMPT_CHARS} caracteres.`, 413, 'PayloadTooLarge');
  }

  next();
}

/** POST /v1/chat/completions */
export function validateOpenAIInput(req, res, next) {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return reject(res, '"messages" debe ser un array no vacío.');
  }

  return validateMessages(messages, res, next);
}

function validateMessages(messages, res, next) {
  if (messages.length > MAX_MESSAGES) {
    return reject(res, `La conversación excede ${MAX_MESSAGES} mensajes.`, 413, 'PayloadTooLarge');
  }

  let totalChars = 0;
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      return reject(res, 'Cada elemento de "messages" debe ser un objeto.');
    }

    // `tool` and `function` turns carry the result of a tool call. Rejecting
    // them made tool calling impossible through the gateway, which broke the
    // "just change the baseURL" promise for any agentic client.
    if (!['system', 'user', 'assistant', 'tool', 'function', 'developer'].includes(message.role)) {
      return reject(res, `Rol no soportado: "${message.role}".`);
    }

    // Multimodal content arrives as an array of parts and is forwarded verbatim.
    // Note that DLP inspects text only: an image is passed through unscanned.
    if (typeof message.content === 'string') {
      totalChars += message.content.length;
    } else if (Array.isArray(message.content)) {
      totalChars += JSON.stringify(message.content).length;
    } else if (message.content === null && Array.isArray(message.tool_calls)) {
      // An assistant turn that only issues tool calls has no textual content.
      totalChars += JSON.stringify(message.tool_calls).length;
    } else {
      return reject(res, '"content" debe ser un string, un array de partes, o null en un turno con tool_calls.');
    }
  }

  if (totalChars > MAX_PROMPT_CHARS) {
    return reject(res, `La conversación excede ${MAX_PROMPT_CHARS} caracteres.`, 413, 'PayloadTooLarge');
  }

  const hasUserTurn = messages.some(m =>
    m.role === 'user' && (
      (typeof m.content === 'string' && m.content.trim().length > 0) ||
      (Array.isArray(m.content) && m.content.length > 0)
    )
  );
  // A follow-up carrying only tool results is a legitimate continuation.
  const hasToolResult = messages.some(m => m.role === 'tool' || m.role === 'function');

  if (!hasUserTurn && !hasToolResult) {
    return reject(res, 'Se requiere al menos un mensaje con role "user" y contenido no vacío.');
  }

  next();
}

/** POST /api/vault/keys */
export function validateVaultInput(req, res, next) {
  const { provider, apiKey } = req.body ?? {};

  if (typeof provider !== 'string' || provider.trim().length === 0) {
    return reject(res, '"provider" es requerido (openai, anthropic, google o custom).');
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length < 16) {
    return reject(res, '"apiKey" es requerido y debe tener al menos 16 caracteres.');
  }

  next();
}

/** POST /api/memory */
export function validateMemoryInput(req, res, next) {
  const { title, content } = req.body ?? {};

  if (typeof title !== 'string' || title.trim().length === 0) {
    return reject(res, '"title" es requerido.');
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return reject(res, '"content" es requerido.');
  }
  if (content.length > 20_000) {
    return reject(res, 'El contenido de una directriz no puede superar 20.000 caracteres.', 413, 'PayloadTooLarge');
  }

  next();
}

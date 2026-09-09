import crypto from 'crypto';
import { ENV } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Auth');

/**
 * Bearer-token authentication for every API route.
 *
 * The gateway holds provider credentials, a prompt history and an audit trail.
 * Before this existed, any process on the machine — and, with permissive CORS,
 * any web page the user had open — could read the vault status, wipe the
 * corporate memory or drain the operator's API budget. Authentication is
 * therefore on by default and can only be turned off explicitly, outside
 * production.
 */

/** Constant-time comparison that tolerates differing lengths. */
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so the failure path costs the same.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  if (header?.startsWith('bearer ')) return header.slice(7).trim();

  // OpenAI SDKs send Authorization; some tooling sends x-api-key instead.
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader) return apiKeyHeader.trim();

  return null;
}

/**
 * Splits an entry of SYNAPSE_API_KEYS into scope and secret.
 *
 * A key may be written as `<scope>:<secret>`. Without a prefix it is `full`.
 * Scopes exist because the browser extension needs to report incidents, and
 * handing every employee's browser a key that also opens the credential vault
 * and the whole audit log is a privilege problem, not a convenience.
 *
 *   full    — everything (default; the operator's own key)
 *   inference — /v1/* and /api/gateway/* only: an application key
 *   report  — /api/extension/event only: the browser extension
 */
export function parseKeyEntry(entry) {
  const separator = entry.indexOf(':');
  if (separator === -1) return { scope: 'full', secret: entry };

  const scope = entry.slice(0, separator);
  if (!['full', 'inference', 'report'].includes(scope)) {
    // An unrecognised prefix is part of the secret, not a scope: a key that
    // happens to contain a colon must not silently become unscoped.
    return { scope: 'full', secret: entry };
  }

  return { scope, secret: entry.slice(separator + 1) };
}

/** Routes each scope is allowed to reach. */
const SCOPE_RULES = {
  full: () => true,
  inference: path => path.startsWith('/v1/') || path.startsWith('/api/gateway/') || path === '/api/models',
  report: path => path === '/api/extension/event'
};

export function createAuthMiddleware(env = ENV) {
  const keys = env.AUTH.API_KEYS.map(parseKeyEntry);

  return function authenticate(req, res, next) {
    if (env.AUTH.DISABLE_AUTH) {
      req.auth = { authenticated: false, tenantId: 'default', mode: 'disabled', scope: 'full' };
      return next();
    }

    if (keys.length === 0) {
      log.error('Petición rechazada: no hay SYNAPSE_API_KEYS configuradas');
      return res.status(503).json({
        error: {
          message: 'El gateway no tiene claves de acceso configuradas. Define SYNAPSE_API_KEYS o SYNAPSE_DISABLE_AUTH=true para uso local.',
          type: 'ConfigurationError',
          code: 503
        }
      });
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        error: { message: 'Falta la cabecera Authorization: Bearer <clave>.', type: 'AuthenticationError', code: 401 }
      });
    }

    const matched = keys.find(key => safeEqual(key.secret, token));
    if (!matched) {
      log.warn('Clave de API inválida', { path: req.originalUrl, ip: req.clientIp });
      return res.status(401).json({
        error: { message: 'Clave de API inválida.', type: 'AuthenticationError', code: 401 }
      });
    }

    // Tenant identity is derived from the key, so cache entries and audit
    // records of different keys never mix.
    req.auth = {
      authenticated: true,
      mode: 'api-key',
      scope: matched.scope,
      tenantId: crypto.createHash('sha256').update(matched.secret).digest('hex').slice(0, 16)
    };

    // The path as seen from the app root: routers mounted under /api strip
    // their prefix from req.path, so the original URL is what the rules match.
    const fullPath = req.originalUrl.split('?')[0];
    if (!SCOPE_RULES[matched.scope](fullPath)) {
      log.warn('Clave fuera de su ámbito', { scope: matched.scope, path: fullPath });
      return res.status(403).json({
        error: {
          message: `Esta clave tiene ámbito "${matched.scope}" y no puede acceder a ${fullPath}.`,
          type: 'AuthorizationError',
          code: 403
        }
      });
    }

    next();
  };
}

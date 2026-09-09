/**
 * SynapseAI Environment Configuration Loader
 *
 * Loads .env (if present), validates the values that matter for a production
 * deployment, and fails fast on unsafe combinations instead of silently
 * starting in a degraded state.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

/** Minimal .env parser — avoids a hard dependency at boot. */
function loadDotEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function int(name, fallback) {
  const raw = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) ? raw : fallback;
}

function float(name, fallback) {
  const raw = parseFloat(process.env[name] ?? '');
  return Number.isFinite(raw) ? raw : fallback;
}

function list(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

export const ENV = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT: int('PORT', 3000),
  HOST: process.env.HOST || '127.0.0.1',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Authentication — a shared bearer token protecting every non-public route.
  AUTH: {
    // Comma-separated list so keys can be rotated without downtime.
    API_KEYS: list('SYNAPSE_API_KEYS'),
    // Only meaningful for a single-user localhost install.
    DISABLE_AUTH: bool('SYNAPSE_DISABLE_AUTH', false)
  },

  // CORS — an allowlist, never a wildcard, because the gateway holds provider keys.
  CORS_ORIGINS: list('SYNAPSE_CORS_ORIGINS', ['http://localhost:3000', 'http://127.0.0.1:3000']),

  // Reverse proxy hops we trust for client IP resolution (0 = trust nobody).
  TRUST_PROXY_HOPS: int('SYNAPSE_TRUST_PROXY_HOPS', 0),

  // Upstream model providers. Keys may also live in the encrypted vault.
  PROVIDERS: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
    GOOGLE_BASE_URL: process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    REQUEST_TIMEOUT_MS: int('SYNAPSE_PROVIDER_TIMEOUT_MS', 120000)
  },

  // Explicit opt-in for the offline echo provider. Never silently substituted.
  ALLOW_MOCK_PROVIDER: bool('SYNAPSE_ALLOW_MOCK_PROVIDER', !IS_PRODUCTION),

  CACHE: {
    // Exact-match caching is safe; similarity matching returns an answer that
    // was generated for a *different* prompt, so it stays opt-in.
    EXACT_ENABLED: bool('SYNAPSE_CACHE_EXACT', true),
    SEMANTIC_ENABLED: bool('SYNAPSE_CACHE_SEMANTIC', false),
    SEMANTIC_THRESHOLD: float('SYNAPSE_CACHE_SEMANTIC_THRESHOLD', 0.97),
    TTL_MS: int('SYNAPSE_CACHE_TTL_MS', 1000 * 60 * 60 * 24),
    MAX_ENTRIES: int('SYNAPSE_CACHE_MAX_ENTRIES', 1000)
  },

  DLP: {
    // BLOCK rejects the request; REDACT forwards the masked text upstream.
    ON_DETECTION: (process.env.SYNAPSE_DLP_ON_DETECTION || 'redact').toLowerCase(),
    // Storing the offending text is what most buyers are trying to avoid.
    STORE_PLAINTEXT_SAMPLES: bool('SYNAPSE_DLP_STORE_PLAINTEXT', false)
  },

  // Spend caps. 0 disables a cap. The gateway sees the cost of every call; these
  // are what let it refuse one. Without them a client in a retry loop drains the
  // operator's provider budget with nothing in the way.
  BUDGET: {
    DAILY_USD_PER_TENANT: float('SYNAPSE_BUDGET_DAILY_USD', 0),
    MONTHLY_USD_PER_TENANT: float('SYNAPSE_BUDGET_MONTHLY_USD', 0),
    DAILY_USD_GLOBAL: float('SYNAPSE_BUDGET_DAILY_USD_GLOBAL', 0),
    MONTHLY_USD_GLOBAL: float('SYNAPSE_BUDGET_MONTHLY_USD_GLOBAL', 0)
  },

  RATE_LIMIT: {
    WINDOW_MS: int('SYNAPSE_RATE_WINDOW_MS', 60_000),
    MAX_REQUESTS: int('SYNAPSE_RATE_MAX', 60),
    MAX_TRACKED_CLIENTS: int('SYNAPSE_RATE_MAX_CLIENTS', 10_000)
  },

  BILLING: {
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || ''
  },

  DATA_DIR: process.env.SYNAPSE_DATA_DIR || path.join(PROJECT_ROOT, 'data')
};

/**
 * Validates the configuration and returns a list of fatal problems.
 * Warnings are returned separately so the caller can log without exiting.
 */
export function validateEnv(env = ENV) {
  const errors = [];
  const warnings = [];

  if (env.IS_PRODUCTION) {
    if (env.AUTH.DISABLE_AUTH) {
      errors.push('SYNAPSE_DISABLE_AUTH no puede estar activo con NODE_ENV=production.');
    } else if (env.AUTH.API_KEYS.length === 0) {
      errors.push('SYNAPSE_API_KEYS es obligatorio en producción (el gateway custodia claves de proveedores).');
    }

    if (env.AUTH.API_KEYS.some(k => k.length < 32)) {
      errors.push('Cada valor de SYNAPSE_API_KEYS debe tener al menos 32 caracteres.');
    }

    if (env.CORS_ORIGINS.includes('*')) {
      errors.push('SYNAPSE_CORS_ORIGINS no admite "*" en producción.');
    }

    if (env.ALLOW_MOCK_PROVIDER) {
      errors.push('SYNAPSE_ALLOW_MOCK_PROVIDER debe estar desactivado en producción: devuelve texto sintético, no inferencia real.');
    }

    if (env.DLP.STORE_PLAINTEXT_SAMPLES) {
      warnings.push('SYNAPSE_DLP_STORE_PLAINTEXT está activo: el registro de auditoría almacenará el texto sensible en claro.');
    }

    if (!env.BILLING.STRIPE_WEBHOOK_SECRET) {
      warnings.push('STRIPE_WEBHOOK_SECRET ausente: el endpoint de webhooks queda deshabilitado.');
    }
  }

  if (env.AUTH.DISABLE_AUTH) {
    warnings.push('Autenticación desactivada: cualquier proceso local puede leer el vault y el historial.');
  }

  if (env.CACHE.SEMANTIC_ENABLED && env.CACHE.SEMANTIC_THRESHOLD < 0.95) {
    warnings.push(`Umbral de caché semántica en ${env.CACHE.SEMANTIC_THRESHOLD}: por debajo de 0.95 se sirven respuestas de prompts distintos.`);
  }

  const budgets = Object.values(env.BUDGET);
  if (budgets.some(v => v < 0)) {
    errors.push('Los límites de presupuesto no pueden ser negativos.');
  }
  if (env.IS_PRODUCTION && budgets.every(v => v === 0)) {
    warnings.push('Sin límites de gasto configurados: el gateway contabiliza el coste pero no detiene a un cliente que agote el presupuesto del proveedor.');
  }
  if (env.BUDGET.DAILY_USD_PER_TENANT > 0 && env.BUDGET.MONTHLY_USD_PER_TENANT > 0
      && env.BUDGET.DAILY_USD_PER_TENANT > env.BUDGET.MONTHLY_USD_PER_TENANT) {
    warnings.push('El límite diario por inquilino supera al mensual: el mensual será el que corte primero.');
  }

  if (!['redact', 'block'].includes(env.DLP.ON_DETECTION)) {
    errors.push(`SYNAPSE_DLP_ON_DETECTION debe ser "redact" o "block" (recibido: "${env.DLP.ON_DETECTION}").`);
  }

  return { errors, warnings, isValid: errors.length === 0 };
}

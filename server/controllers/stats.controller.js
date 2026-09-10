import crypto from 'crypto';
import { dlp, cache, memory, router, providers, auditLedger, telemetry, integrity, budget, env } from '../config/container.js';
import { parseKeyEntry } from '../middlewares/auth.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Stats');

/**
 * GET /api/stats — operational telemetry.
 * Every number here traces back to a measured event; see core/telemetry.js.
 */
export function getStats(req, res) {
  const snapshot = telemetry.snapshot();

  res.json({
    ...snapshot,
    cache: cache.getStats(),
    dlp: {
      totalDetections: dlp.getTotalInterceptions(),
      evasionAttemptsNormalized: dlp.getEvasionAttemptsBlocked(),
      plaintextRetention: env.DLP.STORE_PLAINTEXT_SAMPLES,
      mode: env.DLP.ON_DETECTION
    },
    activeMemories: memory.getAll().filter(m => m.isActive).length,
    providers: providers.status(),
    hasRealProvider: providers.hasRealProvider(),
    budget: budget.status(req.auth?.tenantId ?? 'default')
  });
}

/** GET /api/budget — spend against the configured caps for the caller's tenant. */
export function getBudget(req, res) {
  res.json(budget.status(req.auth?.tenantId ?? 'default'));
}

export function getSecurityLogs(req, res) {
  const entries = auditLedger.getEntries();

  res.json({
    logs: dlp.getAuditLogs(),
    ledger: {
      blocks: entries.length,
      totalAppended: auditLedger.totalAppended,
      integrity: auditLedger.verifyChainIntegrity(),
      // Los ultimos registros, para que la pantalla de auditoria pinte la
      // cadena de verdad en vez de una lista de ejemplo. Van acotados: el
      // fichero entero puede ser muy grande y esta ruta se pide a menudo.
      // El texto original nunca esta aqui — solo su hash.
      recent: entries.slice(-40).reverse().map(record => ({
        index: record.index,
        timestamp: record.timestamp,
        source: record.source,
        severity: record.severity,
        threatsCount: record.threatsCount,
        categories: record.categories,
        payloadHash: record.payloadHash,
        hash: record.hash,
        prevHash: record.prevHash,
        authenticated: record.authenticated
      }))
    },
    totalDetections: dlp.getTotalInterceptions(),
    injectionsBlocked: telemetry.counters.injectionsBlocked
  });
}

/**
 * Catálogo de reglas que el motor DLP tiene compiladas.
 *
 * El panel lo pinta tal cual en lugar de llevar su propia lista escrita a mano:
 * una pantalla de cumplimiento que enumera reglas distintas de las que se
 * ejecutan es peor que no tener pantalla. `checksumValidated` distingue las
 * reglas que comprueban un dígito de control de las que solo reconocen forma,
 * que es exactamente donde están los falsos positivos; `validated` recoge
 * además las que aplican alguna comprobación que no es un checksum.
 */
export function getSecurityRules(req, res) {
  res.json({
    rules: dlp.patterns.map(pattern => ({
      id: pattern.id,
      name: pattern.name,
      category: pattern.category,
      severity: pattern.severity,
      replacement: pattern.replacement,
      // Se declara en el patron, no se deduce de que exista `validate`: el de
      // JWT es estructural y el del correo es una lista de exclusiones, y
      // llamarlos «digito de control» en la pantalla de cumplimiento seria
      // exactamente el tipo de afirmacion que este proyecto retiro del resto
      // del producto.
      checksumValidated: pattern.checksum === true,
      validated: typeof pattern.validate === 'function'
    })),
    onDetection: env.DLP.ON_DETECTION,
    note: 'Las reglas se compilan con el proceso. Para cambiar entre enmascarar y rechazar, usa SYNAPSE_DLP_ON_DETECTION.'
  });
}

/**
 * GET /api/access — quien puede entrar y con que alcance.
 *
 * El producto no tiene cuentas de usuario: la autenticacion es por clave de
 * API, y cada clave es un inquilino cuyo identificador es el hash de su
 * secreto. Esta ruta devuelve exactamente eso y nada mas — nunca el secreto,
 * solo sus cuatro ultimos caracteres, que es lo que permite reconocer una
 * clave sin poder usarla.
 *
 * No se inventa un modelo de personas que no existe. Cuando exista, esta ruta
 * es la que crece.
 */
export function getAccess(req, res) {
  const entries = env.AUTH.API_KEYS.map(parseKeyEntry);
  const actual = req.auth?.tenantId ?? null;

  res.json({
    mode: env.AUTH.DISABLE_AUTH ? 'disabled' : 'keys',
    scopes: {
      full: 'Entra a todo: reglas, credenciales de proveedor y auditoría.',
      inference: 'Solo puede enviar peticiones. No ve la auditoría ni toca la configuración.',
      report: 'Solo lectura de telemetría y auditoría. No puede enviar peticiones ni cambiar nada.'
    },
    current: req.auth ? { tenantId: req.auth.tenantId, scope: req.auth.scope, mode: req.auth.mode ?? 'key' } : null,
    keys: entries.map(entry => {
      const tenantId = crypto.createHash('sha256').update(entry.secret).digest('hex').slice(0, 16);
      return {
        tenantId,
        scope: entry.scope,
        // Los cuatro ultimos caracteres identifican la clave sin revelarla.
        tail: entry.secret.slice(-4),
        isCurrent: tenantId === actual
      };
    }),
    note: env.AUTH.DISABLE_AUTH
      ? 'La autenticación está desactivada: cualquier proceso de esta máquina entra sin clave.'
      : 'Las claves se definen en SYNAPSE_API_KEYS. Rotar una es sustituirla ahí y reiniciar.'
  });
}

export function exportSecurityLogs(req, res) {
  const format = String(req.query.format || 'jsonl').toLowerCase();

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="synapse_audit_ledger.csv"');
    return res.send(auditLedger.exportCSV());
  }

  if (format !== 'jsonl') {
    return res.status(400).json({ error: { message: 'Formato no soportado. Usa "jsonl" o "csv".', code: 400 } });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="synapse_audit_ledger.jsonl"');
  res.send(auditLedger.exportJSONL());
}

export function getModels(req, res) {
  res.json({
    models: router.getAvailableModels(),
    pricesReviewedAt: router.catalog._pricesReviewedAt,
    note: router.catalog._pricesReviewedAt
      ? undefined
      : 'Los precios del catálogo no han sido verificados por un operador; los importes de coste son orientativos.'
  });
}

/**
 * GET /healthz — readiness for load balancers and the dashboard banner.
 * Degraded (503) when no real provider can serve traffic.
 */
export function getHealth(req, res) {
  const chain = auditLedger.verifyChainIntegrity();
  const hasProvider = providers.hasRealProvider();

  const body = {
    status: hasProvider && chain.isValid ? 'ok' : 'degraded',
    version: process.env.npm_package_version || '2.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      providers: { ok: hasProvider, detail: providers.status() },
      auditChain: { ok: chain.isValid, detail: chain },
      cache: { ok: true, size: cache.getStats().size },
      mockProviderActive: !hasProvider && providers.isConfigured('mock')
    }
  };

  res.status(body.status === 'ok' ? 200 : 503).json(body);
}

/** GET /api/integrity — file-hash verification against the shipped manifest. */
export function getIntegrity(req, res) {
  res.json(integrity.verifyIntegrity());
}

/**
 * POST /api/extension/event
 *
 * The browser extension reports the *shape* of a detection — rule ids and the
 * user's decision — so an operator can see leak attempts across the team. It
 * deliberately accepts no prompt text: the extension's whole point is that the
 * draft never leaves the page.
 */
export function recordExtensionEvent(req, res) {
  const { host, decision, rules } = req.body ?? {};

  if (!Array.isArray(rules) || !['redact', 'send', 'cancel'].includes(decision)) {
    return res.status(400).json({ error: { message: 'Se esperaba { host, decision, rules[] }.', code: 400 } });
  }

  // Bounded: this endpoint appends to the audit chain, so an unbounded array is
  // a way to inflate the ledger from a browser.
  if (rules.length > 50) {
    return res.status(413).json({ error: { message: 'Demasiadas reglas en un solo evento (máximo 50).', code: 413 } });
  }

  // The decision goes into `source`, which is part of the hashed canonical
  // record. Keeping it only in the application log left the one field with
  // disciplinary weight — "they were warned and sent it anyway" — outside the
  // tamper-evident chain.
  const entry = auditLedger.append({
    source: `extension:${decision}:${String(host).slice(0, 80)}`,
    detectionsCount: rules.length,
    severity: rules.some(r => r.severity === 'critical') ? 'CRITICAL' : 'HIGH',
    items: rules.map(r => ({ name: String(r.id).slice(0, 60) })),
    payloadHash: null
  });

  log.info('Evento de la extensión registrado', { host, decision, rules: rules.length });
  res.status(202).json({ recorded: true, block: entry.index });
}

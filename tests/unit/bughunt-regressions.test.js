import test from 'node:test';
import assert from 'node:assert/strict';

import { DLPEngine } from '../../server/dlp-engine.js';
import { StreamRedactor } from '../../server/core/stream-redactor.js';
import { ResponseCache } from '../../server/core/response-cache.js';
import { PromptInjectionShield } from '../../server/security/prompt-injection-shield.js';
import { GatewayPipeline } from '../../server/core/pipeline.js';
import { createRateLimiter, resetRateLimiter } from '../../server/middlewares/rate-limiter.js';

/**
 * Defects found while hunting through the rebuilt code, after the adversarial
 * review. Several were introduced by the repair work itself, which is the point
 * of keeping them pinned here.
 */

// ── Redacción en streaming ───────────────────────────────────────────────────

function streamThrough(secret, { tailSize = 256, chunk = 12 } = {}) {
  const redactor = new StreamRedactor(new DLPEngine(), { tailSize });
  const text = `Aquí está: ${secret} y luego texto de relleno. `.padEnd(1500, 'x');

  let emitted = '';
  for (let i = 0; i < text.length; i += chunk) emitted += redactor.push(text.slice(i, i + chunk));
  emitted += redactor.flush();

  return { emitted, redactor };
}

test('REGRESIÓN: un secreto a caballo del límite de liberación no se escapa', () => {
  // La versión anterior escaneaba solo el trozo que iba a liberar, así que un
  // secreto que empezaba ahí y continuaba en la cola nunca aparecía entero en
  // ninguna cadena escaneada: no coincidía nada y el prefijo salía en claro.
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
  const { emitted, redactor } = streamThrough(secret);

  assert.ok(!emitted.includes(secret), 'el secreto no puede llegar al cliente');
  assert.equal(redactor.wasMasked, true);
});

test('REGRESIÓN: un bloque PEM más largo que la cola tampoco se escapa', () => {
  // Ninguna cola de tamaño fijo basta para un secreto sin longitud acotada; hay
  // que retener desde el "opener" hasta que se cierre.
  const pem = '-----BEGIN PRIVATE KEY-----'
    + 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ'.repeat(4)
    + '-----END PRIVATE KEY-----';

  const { emitted } = streamThrough(pem, { tailSize: 96 });
  assert.ok(!emitted.includes(pem), 'un PEM de 252 caracteres se escapaba con cola de 96');
});

test('REGRESIÓN: una cadena de conexión con credenciales no se escapa', () => {
  const conn = 'postgresql://admin:S3cretPassword@db.interno.corp:5432/produccion';
  const { emitted } = streamThrough(conn, { tailSize: 96 });
  assert.ok(!emitted.includes(conn));
});

test('resiste un stream que llega carácter a carácter', () => {
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  const { emitted } = streamThrough(secret, { chunk: 1 });
  assert.ok(!emitted.includes(secret));
});

test('REGRESIÓN: un solo secreto produce una detección, no una por fragmento', () => {
  // El búfer se reescanea en cada fragmento; sin deduplicar, un único secreto
  // inflaba el contador de intercepciones y el registro de auditoría en
  // proporción al número de trozos.
  const dlp = new DLPEngine();
  const redactor = new StreamRedactor(dlp, { tailSize: 96 });
  const text = 'Clave sk-proj-abcdefghijklmnopqrstuvwxyz123456 y relleno. '.padEnd(900, 'x');

  for (let i = 0; i < text.length; i += 12) redactor.push(text.slice(i, i + 12));
  redactor.flush();

  assert.equal(redactor.detections.length, 1);
  assert.equal(dlp.getAuditLogs().length, 0, 'el redactor no debe auditar por fragmento');
  assert.equal(dlp.getTotalInterceptions(), 0, 'el pipeline audita una sola vez al final');
});

test('el texto inocuo se emite íntegro y en orden', () => {
  const redactor = new StreamRedactor(new DLPEngine(), { tailSize: 64 });
  const text = 'El despliegue en producción requiere revisar el proxy inverso. '.repeat(12);

  let emitted = '';
  for (let i = 0; i < text.length; i += 7) emitted += redactor.push(text.slice(i, i + 7));
  emitted += redactor.flush();

  assert.equal(emitted, text);
});

test('un "opener" que aparece en prosa no retiene la salida indefinidamente', () => {
  const redactor = new StreamRedactor(new DLPEngine(), { tailSize: 64, maxHoldChars: 200 });
  const text = 'La variable sk- se usa como prefijo interno. '.padEnd(2000, 'y');

  let emitted = '';
  for (let i = 0; i < text.length; i += 20) emitted += redactor.push(text.slice(i, i + 20));
  emitted += redactor.flush();

  assert.equal(emitted.length, text.length, 'todo el texto debe acabar saliendo');
  assert.equal(redactor.truncatedHold, true, 'y debe quedar señalado que la retención se truncó');
});

// ── Coalescencia de peticiones ───────────────────────────────────────────────

test('REGRESIÓN: la clave de coalescencia distingue conversaciones con el mismo último turno', () => {
  // Claveando solo por el último mensaje, dos conversaciones distintas que
  // terminaban en "¿qué opinas?" se fusionaban y la segunda recibía la
  // respuesta generada a partir del historial de la primera.
  const opciones = { tenantId: 'acme' };

  const conversacionA = [
    { role: 'user', content: 'Mi presupuesto secreto es 4 millones de euros.' },
    { role: 'assistant', content: 'Entendido.' },
    { role: 'user', content: '¿Qué opinas?' }
  ];
  const conversacionB = [
    { role: 'user', content: 'Estoy planeando unas vacaciones a Japón.' },
    { role: 'assistant', content: 'Buena idea.' },
    { role: 'user', content: '¿Qué opinas?' }
  ];

  assert.notEqual(
    GatewayPipeline.coalescingKey(conversacionA, opciones),
    GatewayPipeline.coalescingKey(conversacionB, opciones)
  );
});

test('la clave de coalescencia sí agrupa peticiones idénticas', () => {
  const mensajes = [{ role: 'user', content: 'la misma pregunta' }];
  assert.equal(
    GatewayPipeline.coalescingKey(mensajes, { tenantId: 't' }),
    GatewayPipeline.coalescingKey([{ role: 'user', content: 'la misma pregunta' }], { tenantId: 't' })
  );
});

test('la clave de coalescencia separa inquilinos y parámetros de muestreo', () => {
  const mensajes = [{ role: 'user', content: 'hola' }];
  const base = GatewayPipeline.coalescingKey(mensajes, { tenantId: 'a' });

  assert.notEqual(base, GatewayPipeline.coalescingKey(mensajes, { tenantId: 'b' }));
  assert.notEqual(base, GatewayPipeline.coalescingKey(mensajes, { tenantId: 'a', temperature: 0.9 }));
  assert.notEqual(base, GatewayPipeline.coalescingKey(mensajes, { tenantId: 'a', preferredModel: 'sonnet' }));
});

// ── Caché ────────────────────────────────────────────────────────────────────

test('REGRESIÓN: cosine devuelve siempre la misma forma', () => {
  // Devolvía el número 0 en el caso de norma cero, así que al desestructurar se
  // obtenía undefined y toda comparación posterior era falsa por accidente.
  const vacio = ResponseCache.vectorize('');
  const lleno = ResponseCache.vectorize('hola mundo prueba');

  const degenerado = ResponseCache.cosine(vacio.vector, vacio.norm, lleno.vector, lleno.norm);
  const normal = ResponseCache.cosine(lleno.vector, lleno.norm, lleno.vector, lleno.norm);

  assert.deepEqual(degenerado, { similarity: 0, overlap: 0 });
  assert.equal(typeof normal.similarity, 'number');
  assert.equal(typeof normal.overlap, 'number');
});

// ── Canarios ─────────────────────────────────────────────────────────────────

test('REGRESIÓN: la tabla de canarios está acotada', () => {
  // Solo se purgaban entradas de más de una hora, así que una ráfaga de
  // identificadores de sesión nuevos — que el cliente elige libremente en la
  // cabecera x-synapse-session — hacía crecer la tabla sin límite.
  const shield = new PromptInjectionShield();
  for (let i = 0; i < 20000; i++) shield.generateCanary('sesion-' + i);

  assert.equal(shield.activeCanaries.size, PromptInjectionShield.MAX_SESSIONS);
});

test('la detección de canario en la salida no depende del número de sesiones', () => {
  const shield = new PromptInjectionShield();
  const canary = shield.generateCanary('la-mia');

  // Aunque la sesión haya sido desalojada, el canario sigue reconociéndose.
  for (let i = 0; i < 20000; i++) shield.generateCanary('otra-' + i);

  const result = shield.inspectEgress(`el sistema dice ${canary} literalmente`, 'la-mia');
  assert.equal(result.isCanaryLeaked, true);
  assert.ok(!result.sanitizedResponse.includes(canary));
});

test('una respuesta normal no se marca como fuga de canario', () => {
  const shield = new PromptInjectionShield();
  shield.generateCanary('s1');

  const result = shield.inspectEgress('Una respuesta perfectamente normal del modelo.', 's1');
  assert.equal(result.isCanaryLeaked, false);
});

// ── Límite de peticiones ─────────────────────────────────────────────────────

function llamar(limiter, ip) {
  return new Promise(resolve => {
    const req = { headers: {}, socket: { remoteAddress: ip }, auth: null };
    const res = {
      setHeader() {},
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { resolve(this.statusCode); }
    };
    limiter(req, res, () => resolve(200));
  });
}

test('REGRESIÓN: inundar la tabla no devuelve la cuota a un cliente castigado', async () => {
  // El barrido expulsaba por orden de inserción, incluidos cubos que estaban al
  // límite. Un atacante con 200 identidades nuevas le devolvía la cuota entera
  // a la víctima — o a sí mismo.
  resetRateLimiter();
  const env = { TRUST_PROXY_HOPS: 0, RATE_LIMIT: { WINDOW_MS: 60_000, MAX_REQUESTS: 3, MAX_TRACKED_CLIENTS: 10 } };
  const limiter = createRateLimiter(env);

  for (let i = 0; i < 3; i++) assert.equal(await llamar(limiter, '1.1.1.1'), 200);
  assert.equal(await llamar(limiter, '1.1.1.1'), 429);

  for (let i = 0; i < 200; i++) await llamar(limiter, '10.0.0.' + i);

  assert.equal(await llamar(limiter, '1.1.1.1'), 429, 'la víctima debe seguir limitada');
  resetRateLimiter();
});

test('un cliente por debajo de su cuota sí puede ser desalojado de la tabla', async () => {
  // Olvidar a alguien que no está castigado es inocuo, y es lo que permite que
  // la tabla siga acotada sin premiar la inundación.
  resetRateLimiter();
  const env = { TRUST_PROXY_HOPS: 0, RATE_LIMIT: { WINDOW_MS: 60_000, MAX_REQUESTS: 5, MAX_TRACKED_CLIENTS: 5 } };
  const limiter = createRateLimiter(env);

  for (let i = 0; i < 50; i++) assert.equal(await llamar(limiter, '192.168.1.' + i), 200);
  resetRateLimiter();
});

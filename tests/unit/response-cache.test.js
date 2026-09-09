import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponseCache } from '../../server/core/response-cache.js';

const CONTEXT = 'Actúa con precisión profesional. Prioriza código limpio y seguro. Responde en español. '.repeat(6);

function seeded(options = {}) {
  const cache = new ResponseCache(options);
  cache.set({
    prompt: 'Hola, ¿qué es un gateway de IA?',
    systemContext: CONTEXT,
    tenantId: 'acme',
    model: 'gemini-flash',
    response: 'Un gateway de IA es una capa intermedia.',
    usage: { inputTokens: 20, outputTokens: 30, measured: true }
  });
  return cache;
}

test('sirve una respuesta cacheada solo para un prompt idéntico', () => {
  const cache = seeded();
  const hit = cache.get({ prompt: 'Hola, ¿qué es un gateway de IA?', systemContext: CONTEXT, tenantId: 'acme', model: 'gemini-flash' });

  assert.equal(hit.isHit, true);
  assert.equal(hit.matchType, 'exact');
  assert.equal(hit.response, 'Un gateway de IA es una capa intermedia.');
});

test('normaliza espacios y mayúsculas en la coincidencia exacta', () => {
  const cache = seeded();
  const hit = cache.get({ prompt: '  HOLA,   ¿QUÉ ES UN GATEWAY DE IA?  ', systemContext: CONTEXT, tenantId: 'acme', model: 'gemini-flash' });
  assert.equal(hit.isHit, true);
});

test('REGRESIÓN: un prompt no relacionado nunca recibe la respuesta cacheada', () => {
  // El contexto de sistema, idéntico en todas las peticiones y mucho más largo
  // que el prompt, dominaba el vector coseno y hacía que "receta de paella"
  // coincidiera al 94% con "qué es un gateway de IA".
  const cache = seeded({ semanticEnabled: true, semanticThreshold: 0.97 });

  const miss = cache.get({
    prompt: 'receta de paella valenciana para 8 personas',
    systemContext: CONTEXT,
    tenantId: 'acme',
    model: 'gemini-flash'
  });

  assert.equal(miss.isHit, false, 'un prompt sin relación jamás debe acertar en caché');
});

test('un inquilino no puede leer la caché de otro', () => {
  const cache = seeded();
  const otherTenant = cache.get({ prompt: 'Hola, ¿qué es un gateway de IA?', systemContext: CONTEXT, tenantId: 'otra-empresa', model: 'gemini-flash' });
  assert.equal(otherTenant.isHit, false);
});

test('cambiar las directrices del sistema invalida la caché', () => {
  const cache = seeded();
  const changed = cache.get({
    prompt: 'Hola, ¿qué es un gateway de IA?',
    systemContext: CONTEXT + '\nNueva directriz: responde siempre en inglés.',
    tenantId: 'acme',
    model: 'gemini-flash'
  });
  assert.equal(changed.isHit, false, 'una política nueva no puede servir respuestas de la política anterior');
});

test('cambiar de modelo no reutiliza la respuesta del modelo anterior', () => {
  const cache = seeded();
  const otherModel = cache.get({ prompt: 'Hola, ¿qué es un gateway de IA?', systemContext: CONTEXT, tenantId: 'acme', model: 'sonnet' });
  assert.equal(otherModel.isHit, false);
});

test('las entradas caducan al cumplirse el TTL', async () => {
  const cache = new ResponseCache({ ttlMs: 20 });
  cache.set({ prompt: 'ping', response: 'pong', tenantId: 't', model: 'm' });

  assert.equal(cache.get({ prompt: 'ping', tenantId: 't', model: 'm' }).isHit, true);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(cache.get({ prompt: 'ping', tenantId: 't', model: 'm' }).isHit, false);
});

test('respeta el número máximo de entradas expulsando las más antiguas', () => {
  const cache = new ResponseCache({ maxEntries: 3 });
  for (let i = 0; i < 10; i++) {
    cache.set({ prompt: `prompt ${i}`, response: `r${i}`, tenantId: 't', model: 'm' });
  }

  assert.equal(cache.getStats().size, 3);
  assert.equal(cache.get({ prompt: 'prompt 0', tenantId: 't', model: 'm' }).isHit, false);
  assert.equal(cache.get({ prompt: 'prompt 9', tenantId: 't', model: 'm' }).isHit, true);
});

test('la caché semántica exige umbral alto y solapamiento de palabras clave', () => {
  const cache = new ResponseCache({ semanticEnabled: true, semanticThreshold: 0.9, minKeywordOverlap: 3 });
  cache.set({
    prompt: 'cuales son los horarios de atencion al cliente y soporte tecnico',
    response: 'De 9 a 18h.',
    tenantId: 't', model: 'm'
  });

  // Reformulación casi idéntica: debe acertar.
  const near = cache.get({ prompt: 'cuales son horarios de atencion al cliente y soporte tecnico', tenantId: 't', model: 'm' });
  assert.equal(near.isHit, true);

  // Comparte dos palabras pero pregunta otra cosa: no debe acertar.
  const different = cache.get({ prompt: 'quiero cancelar mi cuenta de cliente', tenantId: 't', model: 'm' });
  assert.equal(different.isHit, false);
});

test('la caché semántica está desactivada salvo activación explícita', () => {
  const cache = new ResponseCache();
  assert.equal(cache.getStats().mode.semantic, false);
});

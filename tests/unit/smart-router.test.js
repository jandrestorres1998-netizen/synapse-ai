import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartRouter } from '../../server/smart-router.js';

/** Registry double: declares exactly which providers are reachable. */
function registry(available = ['openai', 'anthropic', 'google']) {
  return { isConfigured: name => available.includes(name) };
}

test('las consultas breves van al nivel rápido y las complejas al profundo', () => {
  const router = new SmartRouter(registry());

  assert.equal(router.classify('¿Qué hora es?').tier, 'fast');
  assert.equal(router.classify('Refactoriza este módulo para eliminar una race condition').tier, 'deep');
});

test('un contexto muy largo se considera complejo aunque no tenga palabras clave', () => {
  const router = new SmartRouter(registry());
  const classification = router.classify('hola '.repeat(4000));

  assert.equal(classification.isComplex, true);
  assert.equal(classification.tier, 'deep');
});

test('forzar ejecución local prevalece sobre coste y latencia', () => {
  const router = new SmartRouter(registry(['openai', 'ollama']));
  const decision = router.route('resume este documento', { forceLocal: true });

  assert.equal(decision.selectedModel.provider, 'ollama');
});

test('REGRESIÓN: nunca selecciona un proveedor sin credenciales', () => {
  // El catálogo prefiere Gemini Flash por precio, pero Google no está configurado.
  const router = new SmartRouter(registry(['openai']));
  const decision = router.route('una consulta breve');

  assert.equal(decision.selectedModel.provider, 'openai');
});

test('degrada de nivel cuando el nivel objetivo no tiene proveedor disponible', () => {
  const router = new SmartRouter(registry(['google'])); // solo tiene el nivel "fast"
  const decision = router.route('Refactoriza la arquitectura de microservicios');

  assert.equal(decision.selectedModel.provider, 'google');
  assert.equal(decision.degradedFrom, 'deep');
  assert.match(decision.reasoning, /degradó/);
});

test('REGRESIÓN: sin ningún proveedor lanza 503 en vez de responder algo inventado', () => {
  const router = new SmartRouter(registry([]));

  assert.throws(() => router.route('hola'), err => {
    assert.equal(err.status, 503);
    assert.equal(err.code, 'NO_PROVIDER_CONFIGURED');
    return true;
  });
});

test('respeta el modelo solicitado explícitamente si está disponible', () => {
  const router = new SmartRouter(registry());
  const decision = router.route('hola', { preferredModel: 'sonnet' });

  assert.equal(decision.selectedModel.id, 'sonnet');
});

test('ignora un modelo preferido cuyo proveedor no está configurado', () => {
  const router = new SmartRouter(registry(['google']));
  const decision = router.route('hola', { preferredModel: 'sonnet' });

  assert.notEqual(decision.selectedModel.id, 'sonnet');
});

test('el coste se calcula sobre el uso reportado por el proveedor', () => {
  const router = new SmartRouter(registry());
  const cost = router.computeCost('sonnet', { inputTokens: 1_000_000, outputTokens: 1_000_000, measured: true });

  // 3.00 de entrada + 15.00 de salida según el catálogo por defecto.
  assert.equal(cost.usd, 18);
  assert.equal(cost.isEstimate, false);
});

test('marca el coste como estimación cuando el proveedor no reporta uso', () => {
  const router = new SmartRouter(registry());
  const cost = router.computeCost('sonnet', { inputTokens: 1000, outputTokens: 1000, measured: false });

  assert.equal(cost.isEstimate, true);
});

test('REGRESIÓN: la comparación con el modelo de referencia se declara como tal', () => {
  // La versión anterior presentaba esta cifra como "dinero ahorrado".
  const router = new SmartRouter(registry());
  const comparison = router.compareToBaseline('gemini-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000, measured: true });

  assert.ok(comparison.deltaUsd > 0);
  assert.match(comparison.note, /no representa gasto evitado real/);
});

test('comparar el modelo de referencia consigo mismo da diferencia cero', () => {
  const router = new SmartRouter(registry());
  const comparison = router.compareToBaseline('sonnet', { inputTokens: 1000, outputTokens: 1000, measured: true });

  assert.equal(comparison.deltaUsd, 0);
});

test('el listado de modelos marca cuáles están realmente disponibles', () => {
  const router = new SmartRouter(registry(['openai']));
  const models = router.getAvailableModels();

  assert.equal(models.find(m => m.id === 'gpt-4o').available, true);
  assert.equal(models.find(m => m.id === 'gemini-flash').available, false);
});

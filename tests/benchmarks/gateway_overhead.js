/**
 * Measures what the gateway itself costs and what it demonstrably saves.
 *
 * The benchmark it replaces compared SynapseAI against an invented baseline in
 * which every request — including "translate this sentence" — was sent to a
 * flagship model with no caching, then reported the gap as "97% savings". No
 * team operates that way, and the workload was a third literal duplicates, so
 * the cache hit rate was a property of the fixture rather than of the product.
 *
 * What is measured here instead:
 *   1. Per-request overhead the gateway adds on top of the upstream call
 *      (DLP scan + routing + cache lookup). This is a real cost the operator
 *      pays on every request and it is measured against a stub with fixed
 *      latency, so the gateway's contribution is isolated.
 *   2. Cache hit rate on a workload whose duplication ratio is stated up front,
 *      because the hit rate is a property of the traffic, not of the gateway.
 *
 * Run: node tests/benchmarks/gateway_overhead.js
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const UPSTREAM_LATENCY_MS = 50;
const WARMUP = 20;
const ITERATIONS = 200;

// A workload with an explicitly declared duplication ratio.
const UNIQUE_QUERIES = [
  '¿Cuál es el horario de atención al cliente?',
  '¿Cómo solicito un reembolso?',
  'Traduce al inglés: "Confirmamos el envío de su pedido."',
  'Resume esta política de privacidad en tres puntos.',
  'Corrige la ortografía de esta nota de reunión.',
  'Genera un asunto para un correo de bienvenida.',
  'Explica qué es un webhook en una frase.',
  '¿Qué requisitos hay para emitir una factura?',
  'Convierte esta lista de tareas a markdown.',
  'Redacta un recordatorio para la reunión de mañana.'
];
const DUPLICATION_RATIO = 0.4; // 40% of requests repeat an earlier query

function buildWorkload(size) {
  const workload = [];
  for (let i = 0; i < size; i++) {
    if (workload.length > 0 && Math.random() < DUPLICATION_RATIO) {
      workload.push(workload[Math.floor(Math.random() * workload.length)]);
    } else {
      workload.push(`${UNIQUE_QUERIES[i % UNIQUE_QUERIES.length]} #${i}`);
    }
  }
  return workload;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function startStubUpstream() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      // Fixed think-time so gateway overhead is what varies between the two paths.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'bench', model: JSON.parse(body).model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'Respuesta de referencia del stub.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 60 }
        }));
      }, UPSTREAM_LATENCY_MS);
    });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const upstream = await startStubUpstream();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    SYNAPSE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-bench-')),
    SYNAPSE_DISABLE_AUTH: 'true',
    SYNAPSE_ALLOW_MOCK_PROVIDER: 'false',
    OPENAI_API_KEY: 'sk-stub-benchmark',
    OPENAI_BASE_URL: upstream.url,
    ANTHROPIC_API_KEY: '',
    GOOGLE_API_KEY: '',
    LOG_LEVEL: 'error'
  });

  const { pipeline } = await import('../../server/controllers/gateway.controller.js');
  const { cache, telemetry } = await import('../../server/config/container.js');

  // ── Direct upstream call, no gateway ───────────────────────────────────────
  async function callUpstreamDirect(prompt) {
    const res = await fetch(`${upstream.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-stub-benchmark' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] })
    });
    await res.json();
  }

  console.log('='.repeat(78));
  console.log('BENCHMARK DE SOBRECARGA DEL GATEWAY');
  console.log('='.repeat(78));
  console.log(`Upstream simulado con latencia fija: ${UPSTREAM_LATENCY_MS} ms`);
  console.log(`Iteraciones medidas: ${ITERATIONS} (más ${WARMUP} de calentamiento)`);
  console.log(`Ratio de duplicación del workload: ${Math.round(DUPLICATION_RATIO * 100)}% (declarado, no emergente)\n`);

  // ── 1. Latencia sin caché (cada prompt es único) ───────────────────────────
  for (let i = 0; i < WARMUP; i++) await callUpstreamDirect(`calentamiento ${i}`);

  const directTimings = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await callUpstreamDirect(`consulta directa única ${i}`);
    directTimings.push(performance.now() - t0);
  }

  cache.clear();
  for (let i = 0; i < WARMUP; i++) await pipeline.execute([{ role: 'user', content: `calentamiento gw ${i}` }], { tenantId: 'bench' });

  const gatewayTimings = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await pipeline.execute([{ role: 'user', content: `consulta gateway única ${i}` }], { tenantId: 'bench' });
    gatewayTimings.push(performance.now() - t0);
  }

  const directSorted = [...directTimings].sort((a, b) => a - b);
  const gatewaySorted = [...gatewayTimings].sort((a, b) => a - b);

  const overheadP50 = percentile(gatewaySorted, 0.5) - percentile(directSorted, 0.5);
  const overheadP95 = percentile(gatewaySorted, 0.95) - percentile(directSorted, 0.95);

  console.log('1) SOBRECARGA POR PETICIÓN (sin acierto de caché)');
  console.log('   Ruta                       p50        p95');
  console.log(`   Llamada directa      ${percentile(directSorted, 0.5).toFixed(2).padStart(8)} ms ${percentile(directSorted, 0.95).toFixed(2).padStart(8)} ms`);
  console.log(`   A través del gateway ${percentile(gatewaySorted, 0.5).toFixed(2).padStart(8)} ms ${percentile(gatewaySorted, 0.95).toFixed(2).padStart(8)} ms`);
  console.log(`   ► Coste del gateway  ${overheadP50.toFixed(2).padStart(8)} ms ${overheadP95.toFixed(2).padStart(8)} ms\n`);

  // ── 2. Aciertos de caché sobre un workload con duplicación declarada ───────
  // Stats must be reset too, or the hit rate reported below is diluted by the
  // lookups made during the latency phase above.
  cache.clear({ resetStats: true });
  telemetry.reset();

  const workload = buildWorkload(120);
  const cachedTimings = [];

  for (const prompt of workload) {
    const t0 = performance.now();
    const result = await pipeline.execute([{ role: 'user', content: prompt }], { tenantId: 'bench-cache' });
    const elapsed = performance.now() - t0;
    if (result.source === 'cache') cachedTimings.push(elapsed);
  }

  const stats = cache.getStats();
  const snapshot = telemetry.snapshot();
  const cachedSorted = cachedTimings.sort((a, b) => a - b);

  console.log('2) CACHÉ EXACTA SOBRE WORKLOAD REPETITIVO');
  console.log(`   Peticiones ejecutadas:        ${workload.length}`);
  console.log(`   Prompts únicos:               ${new Set(workload).size}`);
  console.log(`   Aciertos de caché:            ${stats.exactHits + stats.semanticHits} (${stats.hitRatePercent}%)`);
  console.log(`   Latencia de un acierto (p50): ${cachedSorted.length ? percentile(cachedSorted, 0.5).toFixed(2) : 'n/a'} ms`);
  console.log(`   Tokens no enviados al proveedor: ${snapshot.counters.tokensAvoidedByCache}`);
  console.log(`   Gasto real acumulado:         $${snapshot.spend.actualUsd.toFixed(6)}\n`);

  console.log('LECTURA HONESTA DE ESTOS NÚMEROS');
  console.log('  • La tasa de aciertos depende del tráfico del cliente, no del gateway.');
  console.log(`    Este workload se construyó con ${Math.round(DUPLICATION_RATIO * 100)}% de duplicados a propósito.`);
  console.log('    Un equipo con prompts mayoritariamente únicos verá una tasa cercana a cero.');
  console.log('  • El ahorro solo es real si esas peticiones se habrían pagado de todas formas.');
  console.log(`  • El gateway añade ~${overheadP50.toFixed(1)} ms (p50) a cada petición que NO acierta en caché.`);
  console.log('='.repeat(78));

  await new Promise(r => upstream.server.close(r));
  process.exit(0);
}

main().catch(err => {
  console.error('Benchmark falló:', err);
  process.exit(1);
});

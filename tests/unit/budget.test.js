import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BudgetLedger, BudgetExceededError } from '../../server/core/budget.js';
import { SmartRouter } from '../../server/smart-router.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-budget-'));
}

test('sin límites configurados no rechaza nada y lo dice', () => {
  const ledger = new BudgetLedger({});
  const decision = ledger.reserve('t', 999);

  assert.equal(decision.allowed, true);
  assert.match(ledger.status('t').note, /no lo detiene/);
});

test('rechaza cuando la reserva superaría el tope diario', () => {
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 1 });

  const primera = ledger.reserve('t', 0.6);
  assert.equal(primera.allowed, true);
  ledger.settle(primera.reservationId, 0.6);

  const segunda = ledger.reserve('t', 0.6);
  assert.equal(segunda.allowed, false);
  assert.match(segunda.reason, /límite de gasto diario del inquilino/);
  assert.equal(segunda.limit, 1);
});

test('CLAVE: las reservas concurrentes no pueden sobrepasar el tope', () => {
  // Comprobar "lo gastado hasta ahora" antes de llamar y sumar el coste real
  // después dejaría que N peticiones simultáneas pasaran todas el control y
  // entre todas se saltaran el límite. La reserva es lo que lo impide.
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 1 });

  const concedidas = [];
  for (let i = 0; i < 20; i++) {
    const d = ledger.reserve('t', 0.3);
    if (d.allowed) concedidas.push(d.reservationId);
  }

  assert.equal(concedidas.length, 3, 'solo caben tres reservas de 0,30 en un tope de 1');
});

test('liquidar por debajo de lo reservado devuelve el margen sobrante', () => {
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 1 });

  const reserva = ledger.reserve('t', 0.9);
  assert.equal(ledger.reserve('t', 0.2).allowed, false, 'mientras está reservado, no cabe más');

  // La llamada resultó mucho más barata que su peor caso.
  ledger.settle(reserva.reservationId, 0.1);

  assert.equal(ledger.reserve('t', 0.8).allowed, true, 'el margen liberado vuelve a estar disponible');
});

test('liberar una reserva no consume presupuesto', () => {
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 1 });

  const reserva = ledger.reserve('t', 0.9);
  ledger.release(reserva.reservationId);

  assert.equal(ledger.status('t').tenant.daily.spentUsd, 0);
  assert.equal(ledger.reserve('t', 0.9).allowed, true);
});

test('los inquilinos no comparten presupuesto', () => {
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 1 });

  const a = ledger.reserve('acme', 0.9);
  ledger.settle(a.reservationId, 0.9);

  assert.equal(ledger.reserve('acme', 0.2).allowed, false);
  assert.equal(ledger.reserve('otra-empresa', 0.9).allowed, true);
});

test('el tope global corta aunque ningún inquilino haya llegado al suyo', () => {
  // Es la exposición real del operador: diez inquilinos por debajo de su tope
  // pueden sumar mucho más de lo que él quiere gastar.
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 10, dailyUsdGlobal: 1 });

  for (let i = 0; i < 3; i++) {
    const d = ledger.reserve('inquilino-' + i, 0.4);
    if (d.allowed) ledger.settle(d.reservationId, 0.4);
  }

  const siguiente = ledger.reserve('inquilino-nuevo', 0.4);
  assert.equal(siguiente.allowed, false);
  assert.match(siguiente.reason, /global/);
});

test('el gasto sobrevive a un reinicio', () => {
  // Un presupuesto que se reinicia al arrancar no es un presupuesto: reiniciar
  // el proceso sería la forma de saltárselo.
  const dir = tmpDir();

  const primero = new BudgetLedger({ dataDir: dir, dailyUsdPerTenant: 1 });
  const reserva = primero.reserve('t', 0.8);
  primero.settle(reserva.reservationId, 0.8);
  primero.flush();

  const segundo = new BudgetLedger({ dataDir: dir, dailyUsdPerTenant: 1 });
  assert.equal(segundo.status('t').tenant.daily.spentUsd, 0.8);
  assert.equal(segundo.reserve('t', 0.5).allowed, false, 'el tope sigue aplicándose tras reiniciar');
});

test('al restaurar se descartan los periodos ya cerrados', () => {
  const dir = tmpDir();
  const ayer = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

  fs.writeFileSync(path.join(dir, 'budget.json'), JSON.stringify({
    version: 1,
    spent: {
      [`t:t:d:${ayer}`]: 99,
      [`t:t:d:${BudgetLedger.day()}`]: 0.25
    }
  }));

  const ledger = new BudgetLedger({ dataDir: dir, dailyUsdPerTenant: 1 });
  assert.equal(ledger.status('t').tenant.daily.spentUsd, 0.25, 'el gasto de anteayer no cuenta hoy');
});

test('las reservas huérfanas caducan y devuelven el presupuesto', () => {
  // Una caída entre reservar y liquidar dejaría presupuesto retenido para
  // siempre.
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 1 });
  ledger.reserve('t', 0.9);

  // Denegada: una reserva rechazada no llega a existir, así que solo hay una.
  assert.equal(ledger.reserve('t', 0.5).allowed, false);
  assert.equal(ledger.expireStaleReservations(-1), 1);
  assert.equal(ledger.reserve('t', 0.9).allowed, true);
});

test('el estado informa de lo gastado, lo reservado y lo restante', () => {
  const ledger = new BudgetLedger({ dailyUsdPerTenant: 2 });

  const gastada = ledger.reserve('t', 0.5);
  ledger.settle(gastada.reservationId, 0.5);
  ledger.reserve('t', 0.25);

  const estado = ledger.status('t').tenant.daily;
  assert.equal(estado.spentUsd, 0.5);
  assert.equal(estado.reservedUsd, 0.25);
  assert.equal(estado.limitUsd, 2);
  assert.equal(estado.remainingUsd, 1.25);
  assert.equal(estado.enforced, true);
});

test('BudgetExceededError usa 402, no 429', () => {
  // No es una limitación de ritmo: reintentar en un segundo no ayuda. O rota el
  // periodo, o el operador sube el tope.
  const error = new BudgetExceededError({ reason: 'sin fondos', scope: 'diario', limit: 1, spent: 1 });

  assert.equal(error.status, 402);
  assert.equal(error.name, 'BudgetExceededError');
});

test('la estimación previa acota por arriba el coste real', () => {
  const router = new SmartRouter({ isConfigured: () => true });
  const prompt = 'x'.repeat(4000); // ~1000 tokens de entrada

  const estimado = router.estimateMaxCost('sonnet', prompt, 1000);
  const real = router.computeCost('sonnet', { inputTokens: 1000, outputTokens: 1000, measured: true });

  assert.ok(estimado >= real.usd, `la estimación (${estimado}) debe acotar al coste real (${real.usd})`);
});

test('una salida más corta de lo permitido cuesta menos que la estimación', () => {
  const router = new SmartRouter({ isConfigured: () => true });

  const estimado = router.estimateMaxCost('sonnet', 'hola', 4000);
  const real = router.computeCost('sonnet', { inputTokens: 1, outputTokens: 50, measured: true });

  assert.ok(estimado > real.usd);
});

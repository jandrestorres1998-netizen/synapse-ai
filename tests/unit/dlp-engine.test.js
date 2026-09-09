import test from 'node:test';
import assert from 'node:assert/strict';
import { DLPEngine } from '../../server/dlp-engine.js';

test('enmascara claves de API y tarjetas con checksum válido', () => {
  const dlp = new DLPEngine();
  const result = dlp.process('clave sk-proj-abcdefghijklmnopqrstuvwxyz123456 y tarjeta 4539578763621486');

  assert.equal(result.wasMasked, true);
  assert.ok(!result.sanitizedText.includes('sk-proj-abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(!result.sanitizedText.includes('4539578763621486'));
  assert.equal(result.detections.length, 2);
});

test('descarta números de 16 dígitos que no pasan Luhn (falso positivo)', () => {
  const dlp = new DLPEngine();
  // 4532892100917721 falla el checksum MOD-10; no es una tarjeta.
  const result = dlp.process('el número de pedido es 4532892100917721');

  assert.equal(result.detections.filter(d => d.patternId === 'credit_card').length, 0);
  assert.ok(result.sanitizedText.includes('4532892100917721'));
});

test('REGRESIÓN: enmascara TODAS las apariciones del mismo secreto', () => {
  // replace() sustituía solo la primera ocurrencia, dejando el resto en claro.
  const dlp = new DLPEngine();
  const card = '4539578763621486';
  const result = dlp.process(`pago con ${card}, confirmar ${card}, recibo ${card}`);

  assert.equal(result.sanitizedText.includes(card), false, 'ninguna copia del número puede sobrevivir');
});

test('REGRESIÓN: el registro de auditoría no guarda el texto sensible en claro', () => {
  const dlp = new DLPEngine();
  dlp.process('mi contraseña es SuperSecreta2024! y mi tarjeta 4539578763621486');

  const [entry] = dlp.getAuditLogs();
  const serialized = JSON.stringify(entry);

  assert.ok(!serialized.includes('SuperSecreta2024!'), 'la contraseña no puede quedar registrada');
  assert.ok(!serialized.includes('4539578763621486'), 'el número de tarjeta no puede quedar registrado');
  assert.ok(entry.payloadHash, 'debe quedar un hash para correlacionar sin exponer');
});

test('los fragmentos de detección no revelan el prefijo de una credencial crítica', () => {
  const dlp = new DLPEngine();
  const result = dlp.process('sk-proj-abcdefghijklmnopqrstuvwxyz123456');
  const [detection] = result.detections;

  assert.ok(!detection.snippet.includes('sk-p'), 'el prefijo identifica la cuenta y no debe mostrarse');
});

test('almacena texto en claro solo cuando el operador lo pide explícitamente', () => {
  const dlp = new DLPEngine({ storePlaintextSamples: true });
  dlp.process('tarjeta 4539578763621486');

  const [entry] = dlp.getAuditLogs();
  assert.equal(entry.plaintextRetained, true);
  assert.ok(entry.sampleBefore.includes('4539578763621486'));
});

test('valida el checksum del DNI español', () => {
  assert.equal(DLPEngine.validateSpanishDNI('12345678Z'), true);
  assert.equal(DLPEngine.validateSpanishDNI('12345678A'), false);
});

test('valida el checksum MOD-97 de un IBAN', () => {
  assert.equal(DLPEngine.validateIBAN('GB82WEST12345698765432'), true);
  assert.equal(DLPEngine.validateIBAN('GB82WEST12345698765433'), false);
});

test('normaliza homoglifos cirílicos antes de escanear', () => {
  const dlp = new DLPEngine();
  // "раssword" empieza con р cirílica: sin normalización el patrón no dispara.
  const result = dlp.process('раssword: MiClaveSecreta123');
  assert.equal(result.wasMasked, true);
});

test('devuelve el texto intacto cuando no hay nada sensible', () => {
  const dlp = new DLPEngine();
  const result = dlp.process('¿Cómo despliego una aplicación Node en producción?');

  assert.equal(result.wasMasked, false);
  assert.equal(result.detections.length, 0);
});

test('tolera entradas que no son texto sin lanzar', () => {
  const dlp = new DLPEngine();
  for (const input of [null, undefined, 42, {}, []]) {
    const result = dlp.process(input);
    assert.equal(result.wasMasked, false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSpanishDNI, validateSpanishCIF, validateMexicanRFC, validateMexicanCURP,
  validateBrazilianCPF, validateBrazilianCNPJ, validateIBAN, validateLuhn
} from '../../server/identity-checksums.js';
import { DLPEngine } from '../../server/dlp-engine.js';

/**
 * These validators are the part of the DLP engine with genuine reuse value:
 * mainstream engines validate US formats well and match Ibero-American
 * identifiers by shape only, which produces enough false positives that
 * operators disable the rules.
 *
 * Each case is asserted in both directions — a valid identifier must pass and a
 * near-miss must fail — because a validator that accepts everything is
 * indistinguishable from no validator at all.
 */

test('DNI/NIE español: modulo 23', () => {
  assert.equal(validateSpanishDNI('12345678Z'), true);
  assert.equal(validateSpanishDNI('X1234567L'), true, 'un NIE con prefijo X debe validar');
  assert.equal(validateSpanishDNI('12345678A'), false, 'letra de control incorrecta');
  assert.equal(validateSpanishDNI('1234567Z'), false, 'longitud inválida');
  assert.equal(validateSpanishDNI(null), false);
});

test('CIF español: control de dígito y de letra', () => {
  // A58818501 es un CIF real y públicamente conocido (entidad tipo A, control numérico).
  assert.equal(validateSpanishCIF('A58818501'), true);
  assert.equal(validateSpanishCIF('A58818502'), false, 'control alterado');
  assert.equal(validateSpanishCIF('B12345678'), false, 'la forma sola no basta');
  assert.equal(validateSpanishCIF('Z12345678'), false, 'letra de tipo no válida');
});

test('REGRESIÓN: el CIF ya no acepta cualquier cosa con su forma', () => {
  // El patrón no tenía validador, así que cualquier referencia de pieza o de
  // factura con esa forma se marcaba como dato fiscal.
  const dlp = new DLPEngine();

  assert.equal(dlp.process('la referencia del pedido es B12345678').wasMasked, false);
  assert.equal(dlp.process('la empresa A58818501 emitió la factura').wasMasked, true);
});

test('RFC mexicano: dígito verificador sobre el identificador rellenado', () => {
  assert.equal(validateMexicanRFC('GODE561231GR8'), true);
  assert.equal(validateMexicanRFC('GODE561231GR9'), false, 'dígito verificador alterado');
  assert.equal(validateMexicanRFC('GODE561331GR8'), false, 'mes 13 no existe');
  assert.equal(validateMexicanRFC('AAA010101AAA'), false);
});

test('CURP mexicana: dígito verificador y entidad federativa', () => {
  assert.equal(validateMexicanCURP('SABC560626MDFLRN01'), true);
  assert.equal(validateMexicanCURP('SABC560626MDFLRN02'), false, 'dígito verificador alterado');
  assert.equal(validateMexicanCURP('SABC560626MZZLRN01'), false, 'entidad federativa inexistente');
  assert.equal(validateMexicanCURP('SABC561326MDFLRN01'), false, 'mes 13 no existe');
});

test('CPF brasileño: dos dígitos verificadores modulo 11', () => {
  assert.equal(validateBrazilianCPF('52998224725'), true);
  assert.equal(validateBrazilianCPF('529.982.247-25'), true, 'debe aceptar el formato con puntuación');
  assert.equal(validateBrazilianCPF('52998224726'), false);
  assert.equal(validateBrazilianCPF('11111111111'), false, 'los dígitos repetidos cuadran pero no se emiten');
});

test('CNPJ brasileño: dos dígitos verificadores', () => {
  assert.equal(validateBrazilianCNPJ('11222333000181'), true);
  assert.equal(validateBrazilianCNPJ('11.222.333/0001-81'), true);
  assert.equal(validateBrazilianCNPJ('11222333000182'), false);
  assert.equal(validateBrazilianCNPJ('11111111111111'), false);
});

test('IBAN: MOD-97', () => {
  assert.equal(validateIBAN('GB82WEST12345698765432'), true);
  assert.equal(validateIBAN('ES9121000418450200051332'), true);
  assert.equal(validateIBAN('GB82WEST12345698765433'), false);
  assert.equal(validateIBAN('GB82'), false, 'demasiado corto');
});

test('Luhn: MOD-10', () => {
  assert.equal(validateLuhn('4539578763621486'), true);
  assert.equal(validateLuhn('4539 5787 6362 1486'), true, 'debe tolerar separadores');
  assert.equal(validateLuhn('4532892100917721'), false);
});

test('el motor detecta y enmascara los identificadores iberoamericanos válidos', () => {
  const dlp = new DLPEngine();

  const casos = [
    ['CURP', 'SABC560626MDFLRN01', 'mx_curp'],
    ['CPF', '529.982.247-25', 'br_cpf'],
    ['CNPJ', '11.222.333/0001-81', 'br_cnpj'],
    ['RFC', 'GODE561231GR8', 'mx_rfc'],
    ['DNI', '12345678Z', 'es_dni_nie']
  ];

  for (const [nombre, valor, patternId] of casos) {
    const result = dlp.process(`el identificador es ${valor}`);
    assert.ok(result.detections.some(d => d.patternId === patternId), `${nombre} debe detectarse`);
    assert.ok(!result.sanitizedText.includes(valor), `${nombre} no puede salir en claro`);
  }
});

test('no marca texto corriente que se parece a un identificador', () => {
  const dlp = new DLPEngine();

  for (const inocuo of [
    'el pedido 123.456.789-00 se envió ayer',
    'la referencia B12345678 corresponde al recambio',
    'el número de serie 000.111.222-33 del equipo'
  ]) {
    assert.equal(dlp.process(inocuo).wasMasked, false, `falso positivo: ${inocuo}`);
  }
});

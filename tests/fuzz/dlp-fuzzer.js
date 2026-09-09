/**
 * Fuzzer for the DLP pipeline.
 *
 * It answers the one question the project could not answer: how many secrets
 * get through. Not by opinion — by taking a known secret, mutating it the way a
 * person plausibly would, pushing it through the real pipeline, and checking
 * whether the raw value survives into what would have been sent upstream.
 *
 * Three outcomes count as safe:
 *   redacted — the value was masked
 *   blocked  — the request was refused (obfuscation, injection)
 *   absent   — the mutation destroyed the literal value, so nothing leaked
 *
 * One counts as a finding:
 *   LEAKED   — the exact secret appeared in the text bound for the provider
 *
 * Findings are split by intent. An 'accidental' leak is a defect: that is the
 * case the product exists for. An 'evasion' leak is documented as out of scope,
 * but it is reported anyway so the scope has a number instead of a shrug.
 *
 * Usage:
 *   node tests/fuzz/dlp-fuzzer.js               # semilla por defecto
 *   node tests/fuzz/dlp-fuzzer.js --seed 1234   # reproduce una tanda
 *   node tests/fuzz/dlp-fuzzer.js --strict      # sale con código 1 si hay
 *                                               # fugas accidentales (para CI)
 */

import { DLPEngine } from '../../server/dlp-engine.js';
import { StreamRedactor } from '../../server/core/stream-redactor.js';
import {
  makeRandom, MUTATIONS, CONVERSATION_MUTATIONS, SECRETS, INNOCUOUS
} from './mutations.js';

const args = process.argv.slice(2);
const seed = Number(args[args.indexOf('--seed') + 1]) || 20260909;
const strict = args.includes('--strict');
const verbose = args.includes('--verbose');

const rnd = makeRandom(seed);
const dlp = new DLPEngine();

const findings = [];
let checks = 0;

/**
 * Separators a reader would ignore when reconstructing a value: whitespace,
 * punctuation used to break a long token across lines, and zero-width padding.
 */
const COSMETIC = /[\s.\-_·]|[​-‏⁠﻿­]/g;

/**
 * Whether a secret is still recoverable from the text a provider would receive.
 *
 * Checking only for the literal string was the fuzzer's own bug: a key wrapped
 * across a line — exactly how one arrives when copied from a PDF or a terminal —
 * no longer contains the literal, so every wrapping mutation scored as safe
 * while the full value sat in the output for anyone to read.
 */
function isRecoverable(text, secret) {
  if (text.includes(secret)) return true;
  return text.replace(COSMETIC, '').includes(secret.replace(COSMETIC, ''));
}

/**
 * @returns {'redacted'|'blocked'|'absent'|'leaked'}
 */
function classify(text, secret) {
  const result = dlp.process(text, 'fuzzer');

  if (result.requiresBlock) return 'blocked';
  // A mutation that destroyed the value (base64, reversal) leaked nothing by
  // definition — but only if it is unrecoverable from the input as well.
  if (!isRecoverable(text, secret)) return 'absent';
  return isRecoverable(result.sanitizedText, secret) ? 'leaked' : 'redacted';
}

function record(outcome, { secretId, mutationId, intent, describe, input, secret }) {
  checks++;
  if (outcome !== 'leaked') return;

  findings.push({ secretId, mutationId, intent, describe, secret, input: input.slice(0, 160) });
}

// ── 1. Un secreto, una mutación, un mensaje ─────────────────────────────────

for (const secret of SECRETS) {
  for (const mutation of MUTATIONS) {
    const input = mutation.apply(secret.value, rnd);
    record(classify(input, secret.value), {
      secretId: secret.id, mutationId: mutation.id, intent: mutation.intent,
      describe: mutation.describe, input, secret: secret.value
    });
  }
}

// ── 2. El mismo recorrido, pero a través del redactor de streaming ──────────

function classifyStreamed(text, secret, chunkSize) {
  const redactor = new StreamRedactor(new DLPEngine());
  let emitted = '';
  for (let i = 0; i < text.length; i += chunkSize) emitted += redactor.push(text.slice(i, i + chunkSize));
  emitted += redactor.flush();

  if (!isRecoverable(text, secret)) return 'absent';
  return isRecoverable(emitted, secret) ? 'leaked' : 'redacted';
}

for (const secret of SECRETS) {
  for (const mutation of MUTATIONS) {
    const input = mutation.apply(secret.value, rnd);
    // Chunk sizes chosen to land boundaries inside and around the secret.
    for (const chunkSize of [1, 3, 7, 13, 29, 64]) {
      record(classifyStreamed(input, secret.value, chunkSize), {
        secretId: secret.id, mutationId: `${mutation.id}+stream${chunkSize}`,
        intent: mutation.intent, describe: `${mutation.describe}, en streaming de ${chunkSize} caracteres`,
        input, secret: secret.value
      });
    }
  }
}

// ── 3. Secretos repartidos por una conversación ─────────────────────────────

for (const secret of SECRETS) {
  for (const mutation of CONVERSATION_MUTATIONS) {
    const messages = mutation.apply(secret.value);
    // The pipeline scans each message independently, which is what this checks.
    const sanitized = messages.map(m => dlp.process(m.content, 'fuzzer').sanitizedText).join('\n');
    const leaked = isRecoverable(sanitized, secret.value);

    record(leaked ? 'leaked' : 'redacted', {
      secretId: secret.id, mutationId: mutation.id, intent: mutation.intent,
      describe: mutation.describe, input: messages.map(m => m.content).join(' / '), secret: secret.value
    });
  }
}

// ── 4. Falsos positivos ─────────────────────────────────────────────────────

const falsePositives = [];
for (const text of INNOCUOUS) {
  const result = dlp.process(text, 'fuzzer');
  if (result.wasMasked || result.requiresBlock) {
    falsePositives.push({ text, detections: result.detections.map(d => d.patternId) });
  }
}

// ── Informe ─────────────────────────────────────────────────────────────────

const accidental = findings.filter(f => f.intent === 'accidental');
const evasion = findings.filter(f => f.intent === 'evasion');

const line = '='.repeat(78);
console.log(line);
console.log('FUZZER DEL DLP');
console.log(line);
console.log(`Semilla: ${seed}   (reproduce con --seed ${seed})`);
console.log(`Comprobaciones: ${checks}   Secretos: ${SECRETS.length}   Mutaciones: ${MUTATIONS.length + CONVERSATION_MUTATIONS.length}\n`);

console.log(`Fugas accidentales : ${accidental.length}   ← defectos: es el caso para el que existe el producto`);
console.log(`Fugas por evasión  : ${evasion.length}   ← documentado como fuera de alcance`);
console.log(`Falsos positivos   : ${falsePositives.length} de ${INNOCUOUS.length} textos inocuos\n`);

function report(title, list) {
  if (list.length === 0) return;
  console.log(`── ${title} ──`);

  const byMutation = new Map();
  for (const f of list) {
    if (!byMutation.has(f.mutationId)) byMutation.set(f.mutationId, []);
    byMutation.get(f.mutationId).push(f.secretId);
  }

  for (const [mutationId, secretIds] of [...byMutation].sort((a, b) => b[1].length - a[1].length)) {
    const sample = list.find(f => f.mutationId === mutationId);
    console.log(`  ${mutationId.padEnd(28)} ${String(secretIds.length).padStart(2)} secreto(s): ${secretIds.slice(0, 6).join(', ')}${secretIds.length > 6 ? '…' : ''}`);
    console.log(`  ${' '.repeat(28)} ${sample.describe}`);
    if (verbose) console.log(`  ${' '.repeat(28)} ejemplo: ${JSON.stringify(sample.input)}`);
  }
  console.log('');
}

report('FUGAS ACCIDENTALES (hay que corregirlas)', accidental);
report('FUGAS POR EVASIÓN (alcance declarado)', evasion);

if (falsePositives.length > 0) {
  console.log('── FALSOS POSITIVOS ──');
  for (const fp of falsePositives) {
    console.log(`  [${fp.detections.join(',')}] ${fp.text.slice(0, 70)}`);
  }
  console.log('');
}

console.log(line);
if (accidental.length === 0 && falsePositives.length === 0) {
  console.log('Sin fugas accidentales ni falsos positivos con esta semilla.');
  console.log('Esto NO significa que no queden: significa que estas mutaciones no las encontraron.');
} else {
  console.log(`${accidental.length} fuga(s) accidental(es) y ${falsePositives.length} falso(s) positivo(s) que corregir.`);
}
console.log(line);

process.exit(strict && (accidental.length > 0 || falsePositives.length > 0) ? 1 : 0);

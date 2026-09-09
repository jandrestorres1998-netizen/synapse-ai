/**
 * Mutation library for the DLP fuzzer.
 *
 * Every mutation takes a secret and returns a variant that a human might
 * plausibly produce — by accident or on purpose — and that should still be
 * caught, blocked, or at minimum not silently forwarded.
 *
 * Mutations are tagged by intent, because the two classes deserve different
 * verdicts:
 *
 *   'accidental' — how a secret realistically arrives when nobody is attacking:
 *                  wrapped across lines, pasted inside a URL, quoted in JSON.
 *                  A miss here is a defect: this is the case the product exists
 *                  for.
 *
 *   'evasion'    — a user deliberately hiding a secret from the filter. The
 *                  documentation already states this is out of scope, so a miss
 *                  is expected. It is still measured, because "out of scope"
 *                  should be a number rather than a shrug.
 *
 * All mutations are pure and deterministic.
 */

/** Deterministic PRNG so a seed reproduces a run exactly. */
export function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 0x100000000;
  };
}

const HOMOGLYPHS = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', s: 'ѕ', x: 'х', y: 'у', i: 'і', j: 'ј' };
const INVISIBLE = ['​', '‌', '‍', '﻿', '­'];

function insertAt(text, index, what) {
  return text.slice(0, index) + what + text.slice(index);
}

export const MUTATIONS = [
  // ── Cómo llega un secreto sin que nadie ataque ──────────────────────────────
  {
    id: 'identity',
    intent: 'accidental',
    describe: 'sin modificar',
    apply: secret => secret
  },
  {
    id: 'wrapped_newline',
    intent: 'accidental',
    describe: 'partido por un salto de línea, como al copiar de una terminal',
    apply: (secret, rnd) => insertAt(secret, 10 + Math.floor(rnd() * (secret.length - 12)), '\n')
  },
  {
    id: 'wrapped_space',
    intent: 'accidental',
    describe: 'partido por un espacio, como al copiar de un PDF',
    apply: (secret, rnd) => insertAt(secret, 10 + Math.floor(rnd() * (secret.length - 12)), ' ')
  },
  {
    id: 'in_url_query',
    intent: 'accidental',
    describe: 'dentro de una URL como parámetro',
    apply: secret => `https://api.interno.corp/v1/debug?token=${secret}&user=42`
  },
  {
    id: 'url_encoded',
    intent: 'accidental',
    describe: 'codificado en porcentaje dentro de una URL',
    apply: secret => `https://api.interno.corp/callback?key=${encodeURIComponent(secret).replace(/-/g, '%2D')}`
  },
  {
    id: 'json_quoted',
    intent: 'accidental',
    describe: 'como valor de un JSON de configuración',
    apply: secret => `{"apiKey": "${secret}", "env": "production"}`
  },
  {
    id: 'yaml_value',
    intent: 'accidental',
    describe: 'como valor de un YAML',
    apply: secret => `production:\n  api_key: ${secret}\n  region: eu-west-1`
  },
  {
    id: 'env_assignment',
    intent: 'accidental',
    describe: 'como línea de un archivo .env',
    apply: secret => `OPENAI_API_KEY=${secret}\nNODE_ENV=production`
  },
  {
    id: 'markdown_fence',
    intent: 'accidental',
    describe: 'dentro de un bloque de código markdown',
    apply: secret => '```bash\nexport TOKEN=' + secret + '\n```'
  },
  {
    id: 'surrounded_by_prose',
    intent: 'accidental',
    describe: 'rodeado de texto abundante',
    apply: secret => `Como comentábamos en la reunión de ayer, adjunto la credencial ${secret} para que puedas reproducir el fallo en el entorno de preproducción.`
  },
  {
    id: 'trailing_punctuation',
    intent: 'accidental',
    describe: 'con puntuación pegada al final',
    apply: secret => `La clave es ${secret}.`
  },
  {
    id: 'repeated',
    intent: 'accidental',
    describe: 'repetido varias veces en el mismo mensaje',
    apply: secret => `${secret} y también ${secret}, confirmado: ${secret}`
  },

  // ── Ocultación deliberada ───────────────────────────────────────────────────
  {
    id: 'base64',
    intent: 'evasion',
    describe: 'codificado en base64',
    apply: secret => Buffer.from(secret, 'utf8').toString('base64')
  },
  {
    id: 'hex',
    intent: 'evasion',
    describe: 'codificado en hexadecimal',
    apply: secret => Buffer.from(secret, 'utf8').toString('hex')
  },
  {
    id: 'zero_width',
    intent: 'evasion',
    describe: 'con caracteres invisibles intercalados',
    apply: (secret, rnd) => insertAt(secret, 8 + Math.floor(rnd() * 5), INVISIBLE[Math.floor(rnd() * INVISIBLE.length)])
  },
  {
    id: 'homoglyph',
    intent: 'evasion',
    describe: 'con homoglifos cirílicos',
    apply: secret => secret.replace(/[acepsxyij]/, c => HOMOGLYPHS[c] ?? c)
  },
  {
    id: 'dotted',
    intent: 'evasion',
    describe: 'con un punto entre cada carácter',
    apply: secret => secret.split('').join('.')
  },
  {
    id: 'reversed',
    intent: 'evasion',
    describe: 'escrito al revés',
    apply: secret => [...secret].reverse().join('')
  },
  {
    id: 'char_codes',
    intent: 'evasion',
    describe: 'como llamada a String.fromCharCode',
    apply: secret => `String.fromCharCode(${[...secret].map(c => c.charCodeAt(0)).join(',')})`
  },
  {
    id: 'html_entities',
    intent: 'evasion',
    describe: 'con entidades HTML',
    apply: secret => secret.replace(/-/g, '&#45;')
  },
  {
    id: 'described_in_prose',
    intent: 'evasion',
    describe: 'descrito en prosa en lugar de escrito',
    apply: secret => `mi clave empieza por ${secret.slice(0, 7)} y continúa con ${secret.slice(7)}`
  }
];

/**
 * Mutations that split a secret across several messages of one conversation.
 * They are separate because they operate on a conversation, not on a string.
 */
export const CONVERSATION_MUTATIONS = [
  {
    id: 'split_across_turns',
    intent: 'evasion',
    describe: 'repartido entre dos turnos de la conversación',
    apply: secret => [
      { role: 'user', content: `La primera mitad de la credencial es ${secret.slice(0, Math.ceil(secret.length / 2))}` },
      { role: 'assistant', content: 'Entendido, espero la segunda parte.' },
      { role: 'user', content: `Y la segunda mitad es ${secret.slice(Math.ceil(secret.length / 2))}` }
    ]
  },
  {
    id: 'buried_in_history',
    intent: 'accidental',
    describe: 'enterrado en un turno antiguo de la conversación',
    apply: secret => [
      { role: 'user', content: `Para el despliegue usamos ${secret}` },
      { role: 'assistant', content: 'De acuerdo.' },
      { role: 'user', content: '¿Puedes resumirme lo que hemos hablado?' }
    ]
  }
];

/** Secrets used as ground truth. Every one is synthetic. */
export const SECRETS = [
  { id: 'openai', value: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456' },
  { id: 'anthropic', value: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' },
  { id: 'aws', value: 'AKIAIOSFODNN7EXAMPLE' },
  { id: 'github', value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
  { id: 'gitlab', value: 'glpat-ABCdefGHIjklMNOpqrST' },
  { id: 'slack', value: 'xoxb-2401234567-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx' },
  { id: 'stripe', value: 'sk_live_51H8qL2abcdefghijklmnopqrstuvwx' },
  { id: 'google', value: 'AIzaSyD_abcdefghijklmnopqrstuvwxyz01234' },
  { id: 'card', value: '4539578763621486' },
  { id: 'iban', value: 'GB82WEST12345698765432' },
  { id: 'dni', value: '12345678Z' },
  { id: 'cif', value: 'A58818501' },
  { id: 'rfc', value: 'GODE561231GR8' },
  { id: 'curp', value: 'SABC560626MDFLRN01' },
  { id: 'cpf', value: '52998224725' },
  { id: 'connection', value: 'postgresql://admin:S3cretPass@db.interno:5432/prod' }
];

/** Text that must never be flagged. Used to measure false positives. */
export const INNOCUOUS = [
  '¿Cómo configuro un proxy inverso con nginx para servir dos aplicaciones?',
  'El pedido 123.456.789-00 se envió ayer por mensajería urgente.',
  'La referencia B12345678 corresponde al recambio de la bomba hidráulica.',
  'Resume este contrato de arrendamiento en tres puntos claros y concisos.',
  'El número de serie del equipo es 000.111.222-33 según la etiqueta.',
  'Traduce al inglés: "Confirmamos la recepción de su pedido."',
  'Explícame la diferencia entre una promesa y un observable en JavaScript.',
  'El sistema anterior tenía reglas de negocio distintas; explícame la migración.',
  'Genera un identificador aleatorio para la sesión de pruebas.',
  'La factura 4532892100917721 está pendiente de cobro desde marzo.',
  'Escribe un test unitario que ignore los casos anteriores ya cubiertos.',
  'Necesito un resumen ejecutivo de la estrategia de precios del trimestre.'
];

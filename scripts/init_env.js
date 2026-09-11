#!/usr/bin/env node
/**
 * Prepara el fichero .env de una instalación nueva.
 *
 * Por qué existe: la guía decía «copia .env.example a .env y arranca», y eso
 * no funciona. El ejemplo trae vacías las tres variables que producción exige
 * —la lista de claves de acceso, la clave del almacén y la del registro— y
 * trae encendido el proveedor simulado, que producción prohíbe. El contenedor
 * arranca con NODE_ENV=production, así que muere al instante y se queda
 * reiniciándose en bucle. Quien instalaba esto por primera vez veía un
 * contenedor dando vueltas y el motivo escondido en `docker logs`.
 *
 * Aquí se generan esos tres valores con el generador criptográfico del
 * sistema y se dejan escritos. No se inventa nada más: el resto del fichero
 * sale tal cual del ejemplo, con sus comentarios, para que se lea y se rellene
 * lo que falte (las claves de OpenAI, Anthropic o Google, que son vuestras).
 *
 *   node scripts/init_env.js
 *
 * Nunca pisa un .env que ya exista: si hay uno, avisa y no toca nada.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EJEMPLO = path.join(RAIZ, '.env.example');
const DESTINO = path.join(RAIZ, '.env');

// 32 bytes en hexadecimal. El validador exige 32 caracteres por entrada y
// cuenta el prefijo del ámbito, pero se generan 64 para no depender de eso.
const secreto = () => crypto.randomBytes(32).toString('hex');

if (fs.existsSync(DESTINO)) {
  console.error('Ya existe un .env en este proyecto. No lo toco.');
  console.error('Si quieres empezar de cero, muévelo a otro sitio primero:');
  console.error('    mv .env .env.anterior');
  process.exit(1);
}

if (!fs.existsSync(EJEMPLO)) {
  console.error('No encuentro .env.example. ¿Estás en la raíz del proyecto?');
  process.exit(1);
}

const claveAcceso = `full:${secreto()}`;

const GENERADOS = {
  SYNAPSE_API_KEYS: claveAcceso,
  SYNAPSE_VAULT_KEY: secreto(),
  SYNAPSE_AUDIT_HMAC_KEY: secreto(),
  // El proveedor simulado devuelve texto sintético: útil para probar la
  // instalación, prohibido en producción. Se deja apagado.
  SYNAPSE_ALLOW_MOCK_PROVIDER: 'false'
};

const lineas = fs.readFileSync(EJEMPLO, 'utf8').split(/\r?\n/);
const escritos = new Set();

const salida = lineas.map(linea => {
  const m = linea.match(/^([A-Z_][A-Z0-9_]*)=/);
  if (!m || !(m[1] in GENERADOS)) return linea;
  escritos.add(m[1]);
  return `${m[1]}=${GENERADOS[m[1]]}`;
});

// Si el ejemplo se queda atrás y alguna variable no estaba, se añade al final
// en vez de fallar en silencio.
const faltan = Object.keys(GENERADOS).filter(k => !escritos.has(k));
if (faltan.length > 0) {
  salida.push('', '# Añadidas por scripts/init_env.js: no estaban en .env.example');
  for (const k of faltan) salida.push(`${k}=${GENERADOS[k]}`);
}

fs.writeFileSync(DESTINO, salida.join('\n'), { encoding: 'utf8', mode: 0o600 });

console.log('');
console.log('  .env creado.');
console.log('');
console.log('  Esta es la clave con la que tus programas hablarán con el gateway.');
console.log('  Se muestra una sola vez; está guardada en .env:');
console.log('');
console.log(`      ${claveAcceso}`);
console.log('');
console.log('  Generadas también la clave del almacén y la del registro de auditoría.');
console.log('');
console.log('  Falta que rellenes a mano, en .env, la clave del proveedor de IA que');
console.log('  vayas a usar: OPENAI_API_KEY, ANTHROPIC_API_KEY o GOOGLE_API_KEY. Sin');
console.log('  ninguna de ellas el gateway arranca, pero responde 503 a todo en vez de');
console.log('  inventarse una respuesta.');
console.log('');
console.log('  El fichero .env no entra en git y no viaja en el paquete. Guárdalo como');
console.log('  guardas una contraseña: quien lo tenga puede usar tus claves de IA.');
console.log('');

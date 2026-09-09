import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEYS_DIR = path.join(__dirname, '../data/keys');

if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

console.log("==============================================================================");
console.log("🔑 GENERADOR DE CLAVES MAESTRAS DE VENDEDOR SYNAPSE AI (ECDSA P-256)");
console.log("==============================================================================\n");

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const pubPath = path.join(KEYS_DIR, 'vendor_public.pem');
const privPath = path.join(KEYS_DIR, 'vendor_private.pem');

fs.writeFileSync(pubPath, publicKey, 'utf8');
fs.writeFileSync(privPath, privateKey, 'utf8');

console.log(`✓ Clave Pública guardada en:  ${pubPath}`);
console.log(`✓ Clave Privada guardada en: ${privPath}`);
console.log("\n⚠️ La clave privada se utiliza para emitir licencias tras el cobro en Stripe/LemonSqueezy.");
console.log("==============================================================================");

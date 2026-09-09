import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEYS_DIR = path.join(__dirname, '../data/keys');
const PRIV_KEY_PATH = path.join(KEYS_DIR, 'vendor_private.pem');

/**
 * Issues a cryptographically signed license key for a customer.
 * @param {Object} options { email, tier, durationDays, maxTenants }
 * @returns {string} Signed license key string
 */
export function issueLicense({ email = 'customer@synapse.ai', tier = 'PRO', durationDays = 365, maxTenants = 1 } = {}) {
  if (!fs.existsSync(PRIV_KEY_PATH)) {
    throw new Error(`Clave privada de vendedor no encontrada en ${PRIV_KEY_PATH}. Ejecuta scripts/generate_vendor_keys.js primero.`);
  }

  const privateKeyPem = fs.readFileSync(PRIV_KEY_PATH, 'utf8');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const payload = {
    licenseId: 'lic_' + crypto.randomBytes(6).toString('hex'),
    tier: tier.toUpperCase(),
    customerEmail: email,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    features: {
      maxTenants,
      unlimitedCache: true,
      customDlpRules: true,
      airGappedMode: tier.toUpperCase() === 'ENTERPRISE'
    }
  };

  const payloadJson = JSON.stringify(payload);
  const b64Payload = Buffer.from(payloadJson, 'utf8').toString('base64url');

  // Sign payload with ECDSA P-256 / SHA-256
  const signer = crypto.createSign('SHA256');
  signer.update(b64Payload);
  signer.end();

  const signature = signer.sign(privateKeyPem);
  const b64Signature = Buffer.from(signature).toString('base64url');

  const licenseKey = `SYNAPSE-v1-${b64Payload}.${b64Signature}`;
  return { licenseKey, payload };
}

// CLI Execution handler
if (process.argv[1] && process.argv[1].endsWith('generate_license.js')) {
  const args = process.argv.slice(2);
  const email = args[0] || 'enterprise.buyer@acmecorp.com';
  const tier = (args[1] || 'AGENCY').toUpperCase();
  const days = parseInt(args[2] || '365', 10);

  console.log("==============================================================================");
  console.log("🎟️ EMISOR DE LICENCIAS CRIPTOGRÁFICAS SYNAPSE AI");
  console.log("==============================================================================\n");

  const { licenseKey, payload } = issueLicense({ email, tier, durationDays: days, maxTenants: tier === 'AGENCY' ? 10 : 1 });

  console.log(`► Cliente:   ${payload.customerEmail}`);
  console.log(`► Plan:      ${payload.tier}`);
  console.log(`► Expira el: ${new Date(payload.expiresAt).toLocaleDateString()}`);
  console.log(`► ID:        ${payload.licenseId}\n`);
  console.log("------------------------------------------------------------------------------");
  console.log("🔑 CLAVE DE LICENCIA GENERADA:");
  console.log(licenseKey);
  console.log("------------------------------------------------------------------------------\n");
  console.log("Esta clave se entrega automáticamente al cliente tras el checkout en Stripe.");
  console.log("==============================================================================");
}

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from './config/logger.js';

const log = createLogger('LicenseManager');

/**
 * Plan definitions.
 *
 * IMPORTANT, and stated here rather than discovered later: **none of these
 * limits are enforced.** No middleware, route or controller reads
 * `maxMonthlyRequests`, `maxTenants` or the feature flags. The FREE plan has
 * one hundred per cent of the product today.
 *
 * That is a deliberate open decision, not an oversight. The package is licensed
 * MIT, so a customer may legally fork it and remove any check that were added;
 * building enforcement on top of that licence would be theatre. Either the
 * licence changes or the tier table goes — see docs/AUDIT_2026.md.
 */
export const PLAN_TIERS = {
  FREE: {
    name: 'Community / Free',
    maxMonthlyRequests: 5000,
    maxTenants: 1,
    customDlpRules: false,
    unlimitedCache: false,
    prioritySupport: false
  },
  PRO: {
    name: 'Prosumer / Indie ($19/mo)',
    maxMonthlyRequests: 50000,
    maxTenants: 1,
    customDlpRules: true,
    unlimitedCache: true,
    prioritySupport: false
  },
  AGENCY: {
    name: 'Agencia & Startup ($79/mo)',
    maxMonthlyRequests: 500000,
    maxTenants: 10,
    customDlpRules: true,
    unlimitedCache: true,
    prioritySupport: true
  },
  ENTERPRISE: {
    name: 'Enterprise / Scale ($499+/mo)',
    maxMonthlyRequests: Infinity,
    maxTenants: Infinity,
    customDlpRules: true,
    unlimitedCache: true,
    prioritySupport: true
  }
};

/**
 * Verifies ECDSA P-256 signed license keys.
 *
 * Known limitation, documented rather than hidden: this is offline signature
 * verification running on hardware the customer controls. Anyone willing to
 * patch two lines of this file, or to swap vendor_public.pem for a keypair of
 * their own, unlocks every tier. That is inherent to self-hosted licensing and
 * no amount of obfuscation changes it. It deters casual sharing of keys; it is
 * not a revenue control. Enforcement that actually holds requires a service
 * the vendor operates.
 */
export class LicenseManager {
  constructor({ dataDir, publicKeyPath = null } = {}) {
    this.dataDir = dataDir;
    this.licenseFile = path.join(dataDir, 'license.key');
    this.publicKeyPath = publicKeyPath ?? path.join(dataDir, 'keys/vendor_public.pem');
    this.activeLicense = null;
    this.publicKey = this._resolvePublicKey();
    this._loadSavedLicense();
    this._warnOnPrivateKeyPresence();
  }

  /** Fails closed: with no vendor key present, no license can validate. */
  _resolvePublicKey() {
    if (!fs.existsSync(this.publicKeyPath)) {
      log.warn('Clave pública de vendedor ausente; toda licencia se rechazará y el sistema queda en plan FREE.', {
        expectedAt: this.publicKeyPath
      });
      return null;
    }

    try {
      return fs.readFileSync(this.publicKeyPath, 'utf8');
    } catch (err) {
      log.error('No se pudo leer la clave pública de vendedor', { error: err.message });
      return null;
    }
  }

  /**
   * The signing key must never sit on a customer's machine — whoever holds it
   * can mint ENTERPRISE licenses at will.
   */
  _warnOnPrivateKeyPresence() {
    const privatePath = path.join(this.dataDir, 'keys/vendor_private.pem');
    if (fs.existsSync(privatePath)) {
      log.error('CLAVE PRIVADA DE VENDEDOR PRESENTE EN ESTA INSTALACIÓN. Cualquiera con acceso al disco puede emitir licencias de cualquier plan. Elimínala de todo artefacto distribuible.', {
        path: privatePath
      });
    }
  }

  /**
   * Sets the public key (useful for tests or custom vendor keys).
   */
  setPublicKey(pemPublicKey) {
    this.publicKey = pemPublicKey;
  }

  /**
   * Verifies and decodes a raw license key string.
   * Format: SYNAPSE-v1-<BASE64_PAYLOAD>.<BASE64_SIGNATURE>
   */
  verifyLicenseKey(licenseKeyString) {
    if (!licenseKeyString || typeof licenseKeyString !== 'string') {
      return { isValid: false, reason: 'Formato de clave nulo o inválido' };
    }

    const trimmed = licenseKeyString.trim();
    if (!trimmed.startsWith('SYNAPSE-v1-')) {
      return { isValid: false, reason: 'Prefijo de licencia inválido (debe iniciar con SYNAPSE-v1-)' };
    }

    const token = trimmed.replace('SYNAPSE-v1-', '');
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { isValid: false, reason: 'Estructura de clave corrupta (payload.signature)' };
    }

    const [b64Payload, b64Signature] = parts;

    if (!this.publicKey) {
      return { isValid: false, reason: 'No hay clave pública de vendedor instalada; no es posible verificar licencias.' };
    }

    try {
      const payloadJson = Buffer.from(b64Payload, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);
      const signature = Buffer.from(b64Signature, 'base64url');

      // Cryptographic verification with ECDSA P-256 / SHA-256
      const verifier = crypto.createVerify('SHA256');
      verifier.update(b64Payload);
      verifier.end();

      const isSignatureValid = verifier.verify(this.publicKey, signature);
      if (!isSignatureValid) {
        return { isValid: false, reason: 'Firma criptográfica inválida. La clave fue alterada o no fue emitida por SynapseAI.' };
      }

      // Expiration check
      const now = new Date();
      const expiresAt = new Date(payload.expiresAt);
      if (expiresAt < now) {
        return { isValid: false, reason: `Licencia expirada el ${expiresAt.toLocaleDateString()}`, payload };
      }

      return {
        isValid: true,
        payload,
        tier: payload.tier || 'FREE',
        planDetails: PLAN_TIERS[payload.tier] || PLAN_TIERS.FREE
      };
    } catch (err) {
      return { isValid: false, reason: `Error procesando la licencia: ${err.message}` };
    }
  }

  /**
   * Activates a license and saves it locally.
   */
  activateLicense(licenseKeyString) {
    const result = this.verifyLicenseKey(licenseKeyString);
    if (!result.isValid) {
      return { success: false, reason: result.reason };
    }

    this.activeLicense = {
      rawKey: licenseKeyString.trim(),
      ...result.payload,
      planDetails: result.planDetails,
      activatedAt: new Date().toISOString()
    };

    this._saveLicense(licenseKeyString.trim());
    return {
      success: true,
      tier: this.activeLicense.tier,
      customerEmail: this.activeLicense.customerEmail,
      expiresAt: this.activeLicense.expiresAt,
      plan: result.planDetails
    };
  }

  /**
   * Deactivates the current license and returns to Free tier.
   */
  deactivateLicense() {
    this.activeLicense = null;
    if (fs.existsSync(this.licenseFile)) {
      try {
        fs.unlinkSync(this.licenseFile);
      } catch (e) {}
    }
    return { success: true, tier: 'FREE', plan: PLAN_TIERS.FREE };
  }

  /**
   * Returns current active license status and allowed features.
   */
  getLicenseStatus() {
    if (!this.activeLicense) {
      return {
        tier: 'FREE',
        plan: PLAN_TIERS.FREE,
        isLicensed: false,
        customerEmail: 'N/A (Community)',
        expiresAt: 'Permanent',
        status: 'COMMUNITY_FREE_TIER',
        enforcement: this.enforcement
      };
    }

    // Re-verify expiration in real-time
    const expiresAt = new Date(this.activeLicense.expiresAt);
    const isExpired = expiresAt < new Date();

    if (isExpired) {
      return {
        tier: 'FREE',
        plan: PLAN_TIERS.FREE,
        isLicensed: false,
        isExpired: true,
        customerEmail: this.activeLicense.customerEmail,
        expiresAt: this.activeLicense.expiresAt,
        status: 'LICENSE_EXPIRED'
      };
    }

    return {
      tier: this.activeLicense.tier,
      plan: this.activeLicense.planDetails || PLAN_TIERS[this.activeLicense.tier],
      isLicensed: true,
      isExpired: false,
      licenseId: this.activeLicense.licenseId,
      customerEmail: this.activeLicense.customerEmail,
      expiresAt: this.activeLicense.expiresAt,
      activatedAt: this.activeLicense.activatedAt,
      status: `ACTIVE_${this.activeLicense.tier}`
    };
  }

  /**
   * Declares what a plan *says* it allows. Callers must not treat this as an
   * access control: nothing in the request path consults it.
   */
  isFeatureAllowed(featureName) {
    const status = this.getLicenseStatus();
    return !!status.plan[featureName];
  }

  /** Surfaced by the API so no dashboard can imply limits that do not exist. */
  get enforcement() {
    return {
      enforced: false,
      note: 'Los límites de plan son declarativos: ningún middleware los aplica y el paquete se distribuye bajo licencia MIT.'
    };
  }

  _saveLicense(rawKey) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.licenseFile, rawKey, 'utf8');
  }

  _loadSavedLicense() {
    if (fs.existsSync(this.licenseFile)) {
      try {
        const rawKey = fs.readFileSync(this.licenseFile, 'utf8').trim();
        const verification = this.verifyLicenseKey(rawKey);
        if (verification.isValid) {
          this.activeLicense = {
            rawKey,
            ...verification.payload,
            planDetails: verification.planDetails,
            activatedAt: new Date().toISOString()
          };
        }
      } catch (e) {
        // Fallback to Free
      }
    }
  }
}

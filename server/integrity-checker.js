import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, '../data/integrity_manifest.json');

/**
 * SynapseAI Software Integrity & SBOM Checker
 * Generates SHA-256 checksums of the core modules so an operator can detect
 * post-deployment modification. It compares against a manifest that lives on the
 * same disk, so it detects accidental drift and unsophisticated tampering, not
 * an attacker who regenerates the manifest after editing the code.
 */
export class IntegrityChecker {
  constructor() {
    this.coreFiles = [
      'server/server.js',
      'server/dlp-engine.js',
      'server/deobfuscator.js',
      'server/secure-vault.js',
      'server/tls-shield.js',
      'server/smart-router.js',
      'server/memory-hub.js',
      'server/license-manager.js',
      'server/core/pipeline.js',
      'server/core/response-cache.js',
      'server/core/stream-redactor.js',
      'server/core/telemetry.js',
      'server/providers/base.js',
      'server/providers/index.js',
      'server/providers/openai.provider.js',
      'server/providers/anthropic.provider.js',
      'server/providers/google.provider.js',
      'server/providers/ollama.provider.js',
      'server/providers/mock.provider.js',
      'server/security/prompt-injection-shield.js',
      'server/security/audit-chain.js',
      'server/store/json-store.js',
      'server/config/env.js',
      'server/config/container.js',
      'server/config/logger.js',
      'server/config/models.json',
      'server/middlewares/auth.js',
      'server/middlewares/validators.js',
      'server/middlewares/security-headers.js',
      'server/middlewares/request-logger.js',
      'server/middlewares/rate-limiter.js',
      'server/middlewares/error-handler.js',
      'server/controllers/gateway.controller.js',
      'server/controllers/vault.controller.js',
      'server/controllers/memory.controller.js',
      'server/controllers/stats.controller.js',
      'server/controllers/license.controller.js',
      'server/routes/api.routes.js'
    ];
  }

  /**
   * Computes SHA-256 hash of a file.
   */
  computeFileHash(relativePath) {
    const fullPath = path.join(PROJECT_ROOT, relativePath);
    if (!fs.existsSync(fullPath)) return null;
    const fileBuffer = fs.readFileSync(fullPath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Generates and saves the baseline integrity manifest.
   */
  generateManifest() {
    const manifest = {
      version: '5.0.0',
      generatedAt: new Date().toISOString(),
      algorithm: 'SHA-256',
      files: {}
    };

    for (const relPath of this.coreFiles) {
      const hash = this.computeFileHash(relPath);
      if (hash) {
        manifest.files[relPath] = hash;
      }
    }

    const dataDir = path.join(PROJECT_ROOT, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  /**
   * Verifies current files against the baseline manifest to detect tampering.
   */
  verifyIntegrity() {
    if (!fs.existsSync(MANIFEST_PATH)) {
      this.generateManifest();
      return { isValid: true, tamperedFiles: [], status: 'MANIFEST_INITIALIZED' };
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      const tamperedFiles = [];

      for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
        const currentHash = this.computeFileHash(relPath);
        if (!currentHash) {
          tamperedFiles.push({ file: relPath, issue: 'FILE_MISSING' });
        } else if (currentHash !== expectedHash) {
          tamperedFiles.push({ file: relPath, issue: 'HASH_MISMATCH', expected: expectedHash, actual: currentHash });
        }
      }

      return {
        isValid: tamperedFiles.length === 0,
        tamperedFiles,
        status: tamperedFiles.length === 0 ? 'INTEGRITY_VERIFIED' : 'TAMPERING_DETECTED',
        totalChecked: Object.keys(manifest.files).length
      };
    } catch (err) {
      return { isValid: false, tamperedFiles: [{ file: 'manifest', issue: err.message }], status: 'VERIFICATION_ERROR' };
    }
  }

  /**
   * Generates a CycloneDX-compliant Software Bill of Materials (SBOM).
   */
  generateSBOM() {
    const pkgPath = path.join(PROJECT_ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    return {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${crypto.randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        component: {
          name: pkg.name,
          version: pkg.version,
          type: 'application',
          description: pkg.description
        }
      },
      dependencies: Object.entries(pkg.dependencies || {}).map(([name, version]) => ({
        ref: `${name}@${version}`,
        name,
        version,
        purl: `pkg:npm/${name}@${version}`
      }))
    };
  }
}

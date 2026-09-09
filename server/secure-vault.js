import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './config/logger.js';

const log = createLogger('SecureVault');

/**
 * AES-256-GCM keystore for upstream provider credentials.
 *
 * Two key modes, and the difference matters:
 *
 *  - `env` (recommended): the master key comes from SYNAPSE_VAULT_KEY, held
 *    outside the filesystem the vault lives on. An attacker who steals
 *    data/vault.enc cannot decrypt it.
 *
 *  - `machine` (fallback): the key is derived from hostname, platform, arch,
 *    CPU model and home directory. None of those are secret. Anyone who can
 *    read the vault file on that machine can also read those values and derive
 *    the same key, so this mode is obfuscation-at-rest, not encryption against
 *    a local attacker. It exists so a laptop install works with zero config,
 *    and it logs a warning every boot.
 */
export class SecureVault {
  constructor({ dataDir, masterKey = process.env.SYNAPSE_VAULT_KEY || '' } = {}) {
    this.dataDir = dataDir;
    this.vaultFile = path.join(dataDir, 'vault.enc');
    fs.mkdirSync(dataDir, { recursive: true });

    if (masterKey) {
      if (masterKey.length < 32) {
        throw new Error('SYNAPSE_VAULT_KEY debe tener al menos 32 caracteres.');
      }
      this.keyMode = 'env';
      this.masterKey = crypto.scryptSync(masterKey, 'synapse_vault_v2', 32);
    } else {
      this.keyMode = 'machine';
      this.masterKey = SecureVault.deriveMachineKey();
      log.warn('Vault en modo "machine": la clave se deriva de identificadores públicos del equipo y no protege frente a un atacante con acceso local. Define SYNAPSE_VAULT_KEY para cifrado real.');
    }

    this.cache = new Map();
    this._load();
  }

  static deriveMachineKey() {
    const fingerprint = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model ?? 'cpu', os.homedir()].join(':::');
    return crypto.scryptSync(fingerprint, 'synapse_vault_hardware_salt_v1', 32);
  }

  _encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');

    return {
      v: 2,
      keyMode: this.keyMode,
      iv: iv.toString('hex'),
      ciphertext,
      authTag: cipher.getAuthTag().toString('hex')
    };
  }

  _decrypt(payload) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
    return decipher.update(payload.ciphertext, 'hex', 'utf8') + decipher.final('utf8');
  }

  _load() {
    if (!fs.existsSync(this.vaultFile)) return;

    try {
      const parsed = JSON.parse(fs.readFileSync(this.vaultFile, 'utf8'));
      for (const [provider, payload] of Object.entries(parsed)) {
        this.cache.set(provider, payload);
      }
    } catch (err) {
      log.error('Vault ilegible; se continúa con un vault vacío (el archivo no se sobrescribe hasta la próxima escritura).', { error: err.message });
    }
  }

  _persist() {
    const serialized = Object.fromEntries(this.cache.entries());
    // Unique per write: a fixed name lets two writes clobber each other's
    // temporary file and land a half-serialized vault on disk.
    const tmp = `${this.vaultFile}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    // 0600: readable only by the owning user, applied before any content lands.
    fs.writeFileSync(tmp, JSON.stringify(serialized, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.vaultFile);
    try {
      fs.chmodSync(this.vaultFile, 0o600);
    } catch {
      // Windows ACLs do not map onto POSIX modes; ignore.
    }
  }

  setKey(provider, apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return false;
    this.cache.set(provider.toLowerCase(), this._encrypt(apiKey.trim()));
    this._persist();
    log.info('Credencial almacenada', { provider: provider.toLowerCase(), keyMode: this.keyMode });
    return true;
  }

  getKey(provider) {
    const payload = this.cache.get(String(provider).toLowerCase());
    if (!payload) return null;

    try {
      return this._decrypt(payload);
    } catch (err) {
      // Most common cause: the machine fingerprint changed, or the env key rotated.
      log.error('Fallo al descifrar la credencial; la clave maestra no coincide con la usada al guardarla.', {
        provider, keyMode: this.keyMode, storedKeyMode: payload.keyMode ?? 'unknown'
      });
      return null;
    }
  }

  /** Never exposes key material — only whether a slot is populated. */
  getVaultStatus() {
    const providers = ['openai', 'anthropic', 'google', 'custom'];
    const status = {};

    for (const provider of providers) {
      const payload = this.cache.get(provider);
      status[provider] = {
        isConfigured: Boolean(payload),
        cipher: payload ? 'AES-256-GCM' : null,
        keyMode: payload?.keyMode ?? null
      };
    }

    return {
      providers: status,
      keyMode: this.keyMode,
      warning: this.keyMode === 'machine'
        ? 'Modo "machine": el cifrado en reposo no resiste a un atacante con acceso al sistema de archivos local. Define SYNAPSE_VAULT_KEY.'
        : null
    };
  }

  deleteKey(provider) {
    const deleted = this.cache.delete(String(provider).toLowerCase());
    if (deleted) this._persist();
    return deleted;
  }
}

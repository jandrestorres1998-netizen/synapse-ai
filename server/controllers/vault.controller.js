import { vault, providers } from '../config/container.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Vault');

export function getVaultStatus(req, res) {
  res.json(vault.getVaultStatus());
}

/**
 * Stores a provider credential and immediately verifies it against the
 * provider, so a typo surfaces here rather than on the first user request.
 */
export async function setVaultKey(req, res) {
  const { provider, apiKey, verify = true } = req.body;
  const normalized = provider.toLowerCase();

  if (!['openai', 'anthropic', 'google', 'custom'].includes(normalized)) {
    return res.status(400).json({ error: { message: 'Proveedor no soportado.', code: 400 } });
  }

  const stored = vault.setKey(normalized, apiKey);
  if (!stored) {
    return res.status(400).json({ error: { message: 'No se pudo almacenar la credencial.', code: 400 } });
  }

  let verification = { attempted: false };
  if (verify && normalized !== 'custom') {
    verification = await verifyCredential(normalized);
  }

  res.json({ success: true, provider: normalized, cipher: 'AES-256-GCM', verification });
}

async function verifyCredential(name) {
  try {
    const provider = providers.get(name);
    // One-token probe: cheapest possible call that still exercises auth.
    await provider.chat({
      model: { openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001', google: 'gemini-2.0-flash' }[name],
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1
    });
    return { attempted: true, ok: true };
  } catch (err) {
    log.warn('La credencial almacenada no superó la verificación', { provider: name, error: err.message });
    return { attempted: true, ok: false, error: err.message };
  }
}

export function deleteVaultKey(req, res) {
  const deleted = vault.deleteKey(req.params.provider);
  if (!deleted) return res.status(404).json({ error: { message: 'Credencial no encontrada.', code: 404 } });
  res.status(204).end();
}

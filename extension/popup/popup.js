/**
 * Popup: gateway status and the two settings the content script reads.
 * The extension protects locally even when the gateway is offline, so the
 * status here is informational, not a prerequisite.
 */

const DEFAULTS = { gatewayUrl: 'http://localhost:3000', reportingEnabled: false, apiKey: '' };

async function loadSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

async function refresh() {
  const settings = await loadSettings();

  const toggle = document.getElementById('chk-reporting');
  if (toggle) toggle.checked = settings.reportingEnabled;

  const urlInput = document.getElementById('input-gateway-url');
  if (urlInput) urlInput.value = settings.gatewayUrl;

  if (!settings.reportingEnabled) {
    setText('gateway-status', 'LOCAL');
    setText('gateway-detail', 'Protección local activa. Reporte al gateway desactivado.');
    return;
  }

  try {
    const res = await fetch(`${settings.gatewayUrl}/healthz`);
    const data = await res.json();
    setText('gateway-status', data.status === 'ok' ? 'CONECTADO' : 'DEGRADADO');
    setText('gateway-detail', `Bloques de auditoría: ${data.checks?.auditChain?.detail?.totalAppended ?? 0}`);
  } catch {
    setText('gateway-status', 'SIN CONEXIÓN');
    setText('gateway-detail', 'La protección local sigue funcionando.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refresh();

  document.getElementById('chk-reporting')?.addEventListener('change', async event => {
    await chrome.storage.local.set({ reportingEnabled: event.target.checked });
    refresh();
  });

  document.getElementById('input-gateway-url')?.addEventListener('change', async event => {
    await chrome.storage.local.set({ gatewayUrl: event.target.value.trim() || DEFAULTS.gatewayUrl });
    refresh();
  });
});

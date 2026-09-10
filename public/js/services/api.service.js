/**
 * Backend REST client for the dashboard.
 *
 * The gateway now requires a bearer token on every /api route. The key is held
 * in sessionStorage rather than localStorage so it does not survive the tab —
 * a dashboard key can spend the operator's provider budget.
 */

const KEY_STORAGE = 'synapse.apiKey';

export class ApiService {
  static getApiKey() {
    try {
      return sessionStorage.getItem(KEY_STORAGE) || '';
    } catch {
      return '';
    }
  }

  static setApiKey(key) {
    try {
      if (key) sessionStorage.setItem(KEY_STORAGE, key);
      else sessionStorage.removeItem(KEY_STORAGE);
    } catch { /* storage unavailable (private mode) */ }
  }

  static async _request(path, { method = 'GET', body } = {}) {
    const key = this.getApiKey();

    const res = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
      const error = new Error('Clave de API requerida o inválida. Introdúcela en la cabecera del panel.');
      error.code = 401;
      throw error;
    }

    if (res.status === 204) return null;

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(payload.error?.message || payload.message || `Error ${res.status}`);
      error.code = res.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  static getHealth() {
    return fetch('/healthz').then(r => r.json());
  }

  static getStats() {
    return this._request('/api/stats');
  }

  static processGateway(prompt, source = 'dashboard') {
    return this._request('/api/gateway/process', { method: 'POST', body: { prompt, source } });
  }

  static getSecurityLogs() {
    return this._request('/api/security/logs');
  }

  /** Catálogo de reglas que el motor DLP tiene compiladas ahora mismo. */
  static getSecurityRules() {
    return this._request('/api/security/rules');
  }

  /** Claves configuradas y su ámbito. Nunca devuelve el secreto. */
  static getAccess() {
    return this._request('/api/access');
  }

  static getIntegrity() {
    return this._request('/api/integrity');
  }

  static getModels() {
    return this._request('/api/models');
  }

  static getMemories() {
    return this._request('/api/memory');
  }

  static createMemory(memory) {
    return this._request('/api/memory', { method: 'POST', body: memory });
  }

  static updateMemory(id, memory) {
    return this._request(`/api/memory/${id}`, { method: 'PUT', body: memory });
  }

  static toggleMemory(id) {
    return this._request(`/api/memory/${id}/toggle`, { method: 'PATCH' });
  }

  static deleteMemory(id) {
    return this._request(`/api/memory/${id}`, { method: 'DELETE' });
  }

  static getVaultStatus() {
    return this._request('/api/vault/status');
  }

  static getBudget() {
    return this._request('/api/budget');
  }

  /**
   * La exportación necesita la cabecera de autorización, así que no puede ser
   * un enlace normal: se pide por fetch y se devuelve como blob.
   */
  static async exportSecurityLogs(format = 'jsonl') {
    const key = this.getApiKey();
    const res = await fetch(`/api/security/export?format=${encodeURIComponent(format)}`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {}
    });

    if (!res.ok) {
      const error = new Error(`No se pudo exportar (${res.status})`);
      error.code = res.status;
      throw error;
    }

    return res.blob();
  }

  static setVaultKey(provider, apiKey) {
    return this._request('/api/vault/keys', { method: 'POST', body: { provider, apiKey } });
  }

  static getLicenseStatus() {
    return this._request('/api/license/status');
  }

  static activateLicense(licenseKey) {
    return this._request('/api/license/activate', { method: 'POST', body: { licenseKey } });
  }

  static deactivateLicense() {
    return this._request('/api/license/deactivate', { method: 'DELETE' });
  }
}

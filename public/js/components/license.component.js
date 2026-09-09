import { ApiService } from '../services/api.service.js';

export class LicenseComponent {
  static init() {
    window.activateLicenseKey = this.activate.bind(this);
    window.deactivateLicenseKey = this.deactivate.bind(this);
    window.loadLicenseStatus = this.render.bind(this);
  }

  static async render() {
    try {
      const data = await ApiService.getLicenseStatus();
      
      const badge = document.getElementById('license-badge-tier');
      const planName = document.getElementById('lic-plan-name');
      const customerEmail = document.getElementById('lic-customer-email');
      const expiresAt = document.getElementById('lic-expires-at');
      const maxReq = document.getElementById('lic-max-req');

      if (!badge) return;

      if (data.isLicensed) {
        badge.innerText = `PLAN ACTIVO: ${data.tier}`;
        badge.style.color = 'var(--accent-emerald)';
        badge.style.borderColor = 'var(--accent-emerald)';
        badge.style.background = 'rgba(16, 185, 129, 0.15)';

        planName.innerText = data.plan.name;
        planName.style.color = 'var(--accent-emerald)';
        customerEmail.innerText = data.customerEmail;
        expiresAt.innerText = new Date(data.expiresAt).toLocaleDateString();
        maxReq.innerText = data.plan.maxMonthlyRequests === Infinity ? 'Ilimitadas' : data.plan.maxMonthlyRequests.toLocaleString() + ' / mes';
      } else {
        badge.innerText = 'PLAN: FREE (COMMUNITY)';
        badge.style.color = 'var(--accent-cyan)';
        badge.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        badge.style.background = 'rgba(56, 189, 248, 0.1)';

        planName.innerText = 'Community Free';
        planName.style.color = 'var(--accent-cyan)';
        customerEmail.innerText = 'N/A (Sin registrar)';
        expiresAt.innerText = 'Ilimitada (Community)';
        maxReq.innerText = '5,000 / mes';
      }
    } catch (err) {
      console.error('[LicenseComponent] Error fetching license:', err);
    }
  }

  static async activate() {
    const input = document.getElementById('input-license-key');
    const key = input.value.trim();

    if (!key) {
      alert('Por favor ingresa una clave de licencia válida.');
      return;
    }

    try {
      const result = await ApiService.activateLicense(key);
      alert(`¡Licencia activada con éxito! Plan: ${result.tier}`);
      input.value = '';
      this.render();
    } catch (err) {
      alert(`Error al activar la licencia: ${err.message}`);
    }
  }

  static async deactivate() {
    if (!confirm('¿Deseas desactivar la licencia comercial y volver al plan Free?')) return;

    try {
      await ApiService.deactivateLicense();
      alert('Licencia desactivada. Plan restablecido a Community Free.');
      this.render();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }
}

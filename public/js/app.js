/**
 * Dashboard entry point.
 */

import { ApiService } from './services/api.service.js';
import { OverviewComponent } from './components/overview.component.js';
import { PlaygroundComponent } from './components/playground.component.js';
import { SecurityComponent } from './components/security.component.js';
import { MemoryComponent } from './components/memory.component.js';
import { LicenseComponent } from './components/license.component.js';

const REFRESH_MS = 5000;

class App {
  static init() {
    PlaygroundComponent.init();
    SecurityComponent.init();
    MemoryComponent.init();
    LicenseComponent.init();

    this._mountApiKeyControl();

    window.switchTab = this.switchTab.bind(this);
    window.refreshDashboard = () => OverviewComponent.render();

    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    OverviewComponent.render();
    MemoryComponent.render();
    LicenseComponent.render();

    // Only poll the visible tab: refreshing every panel every 5s was four
    // requests per tick against a rate-limited API.
    setInterval(() => {
      if (document.hidden) return;
      const active = document.querySelector('.nav-tab.active')?.dataset.tab;
      if (active === 'overview' || !active) OverviewComponent.render();
      if (active === 'security') SecurityComponent.render();
    }, REFRESH_MS);
  }

  /**
   * The API now requires a bearer token. Rather than fail silently with 401s,
   * the dashboard asks for it and keeps it for the session only.
   */
  static _mountApiKeyControl() {
    const nav = document.getElementById('topNav');
    if (!nav) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:auto;';

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Clave de API';
    input.autocomplete = 'off';
    input.value = ApiService.getApiKey();
    input.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 10px;color:inherit;font-size:0.75rem;width:180px;';

    const status = document.createElement('span');
    status.style.cssText = 'font-size:0.7rem;color:var(--text-muted);';

    const apply = async () => {
      ApiService.setApiKey(input.value.trim());
      status.innerText = 'comprobando…';
      try {
        await ApiService.getStats();
        status.innerText = '✓ autenticado';
        status.style.color = 'var(--accent-emerald)';
        OverviewComponent.render();
      } catch (err) {
        status.innerText = err.code === 401 ? '✖ clave inválida' : '✖ sin conexión';
        status.style.color = 'var(--accent-rose)';
      }
    };

    input.addEventListener('change', apply);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });

    wrapper.append(input, status);
    nav.appendChild(wrapper);

    // A local install may run with authentication disabled; probe once so the
    // field is not shown as an error when no key is needed.
    ApiService.getStats()
      .then(() => { status.innerText = input.value ? '✓ autenticado' : 'sin autenticación'; })
      .catch(() => { status.innerText = 'clave requerida'; });
  }

  static switchTab(tabId) {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${tabId}`);
    });

    if (tabId === 'overview') OverviewComponent.render();
    if (tabId === 'security') SecurityComponent.render();
    if (tabId === 'memory') MemoryComponent.render();
    if (tabId === 'integration') LicenseComponent.render();
  }
}

document.addEventListener('DOMContentLoaded', () => App.init());

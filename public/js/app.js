/**
 * Punto de entrada del panel.
 *
 * La navegación va ordenada por lo que hace el operador de verdad: Probar
 * primero, porque es lo que se hace al evaluar y a diario; los ajustes al
 * final, porque se tocan una vez.
 */

import { ApiService } from './services/api.service.js';
import { $, setText, money } from './ui.js';
import { ProbarComponent } from './components/probar.component.js';
import { ActividadComponent } from './components/actividad.component.js';
import { ProteccionComponent } from './components/proteccion.component.js';
import { ContextoComponent } from './components/contexto.component.js';
import { AjustesComponent } from './components/ajustes.component.js';

const RENDERERS = {
  probar: null,
  actividad: () => ActividadComponent.render(),
  proteccion: () => ProteccionComponent.render(),
  contexto: () => ContextoComponent.render(),
  ajustes: () => AjustesComponent.render()
};

const REFRESH_MS = 6000;

class App {
  static init() {
    ProbarComponent.init();
    ActividadComponent.init();
    ContextoComponent.init();

    this.wireTabs();
    this.wireApiKey();

    // La barra superior se mantiene al día aunque estés en otra pestaña: el
    // gasto y el estado de los proveedores importan desde cualquier pantalla.
    this.refreshTopbar();
    setInterval(() => {
      if (document.hidden) return;
      this.refreshTopbar();
      const active = document.querySelector('.nav-tab.active')?.dataset.tab;
      if (active === 'actividad') ActividadComponent.render();
    }, REFRESH_MS);

    document.addEventListener('synapse:activity', () => this.refreshTopbar());
  }

  static wireTabs() {
    document.querySelectorAll('.nav-tab').forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });
  }

  static switchTab(tab) {
    document.querySelectorAll('.nav-tab').forEach(button =>
      button.classList.toggle('active', button.dataset.tab === tab));
    document.querySelectorAll('.pane').forEach(pane =>
      pane.classList.toggle('active', pane.id === `pane-${tab}`));

    RENDERERS[tab]?.();
  }

  static wireApiKey() {
    const input = $('api-key');
    const btn = $('btn-validate-key');
    if (!input) return;

    input.value = ApiService.getApiKey();

    const apply = async () => {
      const val = input.value.trim();
      ApiService.setApiKey(val);
      this.renderKeyState('checking');
      const ok = await this.refreshTopbar();
      if (ok) {
        this.renderKeyState('ok');
        const active = document.querySelector('.nav-tab.active')?.dataset.tab;
        RENDERERS[active]?.();
      } else {
        this.renderKeyState(val ? 'invalid' : 'empty');
      }
    };

    if (btn) {
      btn.addEventListener('click', () => apply());
    }
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apply();
      }
    });

    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => apply(), 600);
    });

    if (input.value) {
      apply();
    } else {
      this.renderKeyState('empty');
    }
  }

  static renderKeyState(state) {
    const badge = $('key-state');
    const wrapper = document.querySelector('.key-input-wrapper');
    const btn = $('btn-validate-key');
    if (!badge) return;

    badge.className = 'key-badge ' + state;
    if (state === 'ok') {
      badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Conectado';
      if (wrapper) wrapper.classList.add('is-valid');
      if (btn) btn.textContent = 'Actualizar';
    } else if (state === 'invalid') {
      badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Clave incorrecta';
      if (wrapper) wrapper.classList.remove('is-valid');
      if (btn) btn.textContent = 'Validar';
    } else if (state === 'checking') {
      badge.textContent = 'Comprobando…';
      if (btn) btn.textContent = '…';
    } else {
      badge.textContent = 'Introduce tu clave';
      if (wrapper) wrapper.classList.remove('is-valid');
      if (btn) btn.textContent = 'Validar';
    }
  }

  /** @returns {Promise<boolean>} si la API respondió correctamente. */
  static async refreshTopbar() {
    try {
      const stats = await ApiService.getStats();

      this.renderKeyState('ok');
      this.renderProviderState(stats);
      this.renderSpend(stats.budget, stats.spend);
      return true;
    } catch (err) {
      this.renderKeyState(err.code === 401 ? 'invalid' : 'empty');
      $('provider-dot').className = 'dot critical';
      setText('provider-label', err.code === 401 ? 'Sin autenticar' : 'Gateway no responde');
      return false;
    }
  }

  static renderProviderState(stats) {
    const providers = stats.providers ?? {};
    const active = Object.entries(providers)
      .filter(([name, s]) => s.configured && name !== 'mock')
      .map(([name]) => name);

    const dot = $('provider-dot');

    if (active.length === 0) {
      dot.className = 'dot critical';
      setText('provider-label', providers.mock?.configured ? 'Solo proveedor mock' : 'Sin proveedores');
      return;
    }

    dot.className = 'dot ok';
    setText('provider-label', active.join(' · '));
  }

  static renderSpend(budget, spend) {
    const daily = budget?.tenant?.daily;
    const chip = $('spend-chip');

    setText('spend-value', money(spend?.actualUsd ?? 0, { compact: true }));

    if (daily?.enforced && daily.limitUsd > 0) {
      setText('spend-limit', `/ ${money(daily.limitUsd, { compact: true })}`);
      const used = (daily.spentUsd + daily.reservedUsd) / daily.limitUsd;
      chip.classList.toggle('near-limit', used >= 0.8);
    } else {
      setText('spend-limit', 'sin tope');
      chip.classList.remove('near-limit');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => App.init());

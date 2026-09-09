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
    if (!input) return;

    input.value = ApiService.getApiKey();

    const apply = async () => {
      ApiService.setApiKey(input.value.trim());
      setText('key-state', 'comprobando…');
      const ok = await this.refreshTopbar();
      if (ok) {
        const active = document.querySelector('.nav-tab.active')?.dataset.tab;
        RENDERERS[active]?.();
      }
    };

    input.addEventListener('change', apply);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') apply(); });
  }

  /** @returns {Promise<boolean>} si la API respondió correctamente. */
  static async refreshTopbar() {
    try {
      const stats = await ApiService.getStats();

      setText('key-state', ApiService.getApiKey() ? 'autenticado' : '');
      this.renderProviderState(stats);
      this.renderSpend(stats.budget, stats.spend);
      return true;
    } catch (err) {
      setText('key-state', err.code === 401 ? 'clave requerida' : 'sin conexión');
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

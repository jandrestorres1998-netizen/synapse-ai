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

    // La barra lateral se mantiene al día aunque estés en otro módulo: el gasto
    // y el estado de los proveedores importan desde cualquier pantalla.
    this.refreshSidebar();
    setInterval(() => {
      if (document.hidden) return;
      this.refreshSidebar();
      const active = document.querySelector('.side-item.active')?.dataset.tab;
      if (active === 'actividad') ActividadComponent.render();
    }, REFRESH_MS);

    document.addEventListener('synapse:activity', () => this.refreshSidebar());
  }

  static wireTabs() {
    document.querySelectorAll('.side-item').forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });
  }

  static switchTab(tab) {
    document.querySelectorAll('.side-item').forEach(button =>
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
      const ok = await this.refreshSidebar();
      if (ok) {
        this.renderKeyState('ok');
        const active = document.querySelector('.side-item.active')?.dataset.tab;
        RENDERERS[active]?.();
      } else {
        this.renderKeyState(val ? 'invalid' : 'empty');
      }
    };

    btn?.addEventListener('click', () => apply());
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

    if (input.value) apply();
    else this.renderKeyState('empty');
  }

  static renderKeyState(state) {
    const badge = $('key-state');
    const wrapper = document.querySelector('.key-input-wrapper');
    const btn = $('btn-validate-key');
    if (!badge) return;

    badge.className = `key-badge ${state}`;
    wrapper?.classList.toggle('is-valid', state === 'ok');

    const label = {
      ok: 'Conectado',
      invalid: 'Clave incorrecta',
      checking: 'Comprobando…',
      empty: 'Introduce tu clave'
    }[state] ?? '';

    badge.textContent = label;
    if (btn) btn.textContent = state === 'ok' ? 'Actualizar' : state === 'checking' ? '…' : 'Validar';
  }

  /** @returns {Promise<boolean>} si la API respondió correctamente. */
  static async refreshSidebar() {
    try {
      const stats = await ApiService.getStats();

      this.renderKeyState('ok');
      this.renderProviderState(stats);
      this.renderSpend(stats.budget, stats.spend);
      return true;
    } catch (err) {
      this.renderKeyState(err.code === 401 ? 'invalid' : 'empty');
      const dot = $('provider-dot');
      if (dot) dot.className = 'dot critical';
      setText('provider-label', err.code === 401 ? 'Sin autenticar' : 'Gateway no responde');
      return false;
    }
  }

  static renderProviderState(stats) {
    const providers = stats.providers ?? {};
    const active = Object.entries(providers)
      .filter(([name, state]) => state.configured && name !== 'mock')
      .map(([name]) => name);

    const dot = $('provider-dot');
    if (!dot) return;

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

    setText('spend-value', money(spend?.actualUsd ?? 0, { compact: true }));

    const bar = $('spend-bar');
    const fill = bar?.querySelector('span');

    if (daily?.enforced && daily.limitUsd > 0) {
      setText('spend-limit', `/ ${money(daily.limitUsd, { compact: true })}`);
      const used = (daily.spentUsd + daily.reservedUsd) / daily.limitUsd;
      const pct = Math.min(100, used * 100);
      if (fill) fill.style.width = `${pct}%`;
      if (bar) bar.className = `bar${pct >= 90 ? ' critical' : pct >= 80 ? ' warning' : ''}`;
      setText('spend-note', pct >= 80
        ? 'Cerca del tope. Las siguientes peticiones pueden rechazarse con 402.'
        : 'Reserva previa activa: se aparta el coste máximo antes de llamar.');
    } else {
      setText('spend-limit', 'sin tope');
      if (fill) fill.style.width = '0%';
      if (bar) bar.className = 'bar';
      setText('spend-note', 'Sin tope configurado: se contabiliza, no se detiene.');
    }
  }

}

document.addEventListener('DOMContentLoaded', () => App.init());

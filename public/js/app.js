/**
 * Punto de entrada del panel SynapseAI.
 *
 * Módulos ordenados según el uso real y la jerarquía visual del lienzo v2:
 * - Operación: Inicio, Probar, Actividad
 * - Gobierno: Protección, Auditoría, Usuarios y roles
 * - Configuración: Contexto, Proveedores y claves
 */

import { ApiService } from './services/api.service.js';
import { $, setText, money } from './ui.js';
import { InicioComponent } from './components/inicio.component.js';
import { ProbarComponent } from './components/probar.component.js';
import { ActividadComponent } from './components/actividad.component.js';
import { ProteccionComponent } from './components/proteccion.component.js';
import { AuditoriaComponent } from './components/auditoria.component.js';
import { UsuariosComponent } from './components/usuarios.component.js';
import { ContextoComponent } from './components/contexto.component.js';
import { AjustesComponent } from './components/ajustes.component.js';

let inicioComp = null;
let auditoriaComp = null;
let usuariosComp = null;

const RENDERERS = {
  inicio: () => {
    const el = $('inicio-container');
    if (el) {
      if (!inicioComp) inicioComp = new InicioComponent(el);
      inicioComp.render();
    }
  },
  probar: null,
  actividad: () => ActividadComponent.render(),
  proteccion: () => ProteccionComponent.render(),
  auditoria: () => {
    const el = $('auditoria-container');
    if (el) {
      if (!auditoriaComp) auditoriaComp = new AuditoriaComponent(el);
      auditoriaComp.render();
    }
  },
  usuarios: () => {
    const el = $('usuarios-container');
    if (el) {
      if (!usuariosComp) usuariosComp = new UsuariosComponent(el);
      usuariosComp.render();
    }
  },
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
    this.wireTopActions();

    // Render initial tab (inicio)
    // La URL manda sobre el módulo marcado en el HTML.
    const initialTab = this.tabDeLaUrl()
      || document.querySelector('.side-item.active')?.dataset.tab
      || 'inicio';
    this.switchTab(initialTab);

    window.addEventListener('hashchange', () => {
      const destino = this.tabDeLaUrl();
      if (destino) this.switchTab(destino);
    });

    // Actualización de estado en segundo plano
    this.refreshSidebar();
    setInterval(() => {
      if (document.hidden) return;
      this.refreshSidebar();
      const active = document.querySelector('.side-item.active')?.dataset.tab;
      if (active === 'actividad') ActividadComponent.render();
    }, REFRESH_MS);

    document.addEventListener('synapse:activity', () => {
      this.refreshSidebar();
      const active = document.querySelector('.side-item.active')?.dataset.tab;
      if (active === 'inicio' && inicioComp) inicioComp.loadRealData();
    });

    window.switchDashboardTab = (tab) => this.switchTab(tab);

    // Botones de cabecera que solo llevan a otro módulo.
    document.querySelectorAll('[data-goto]').forEach(boton => {
      boton.addEventListener('click', () => this.switchTab(boton.dataset.goto));
    });

    // «Añadir proveedor» vive en la cabecera, fuera del contenedor del módulo,
    // así que se conecta aquí con el diálogo que pinta Ajustes.
    document.getElementById('btn-open-add-provider')?.addEventListener('click', () => {
      document.querySelector('#modal-add-provider')?.classList.add('open');
    });
  }

  static wireTabs() {
    document.querySelectorAll('.side-item').forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
    });
  }

  /** Módulos válidos, para no aceptar cualquier cosa que venga en la URL. */
  static get MODULOS() {
    return ['inicio', 'probar', 'actividad', 'proteccion', 'auditoria', 'usuarios', 'contexto', 'ajustes'];
  }

  /**
   * El módulo abierto vive en la URL. Sirve para enlazar directamente a una
   * pantalla —«mira esto en Auditoría»— y para que recargar no te devuelva al
   * principio.
   */
  static tabDeLaUrl() {
    const desdeHash = (location.hash || '').replace(/^#/, '');
    return this.MODULOS.includes(desdeHash) ? desdeHash : null;
  }

  static switchTab(tab) {
    if (!tab) return;
    document.querySelectorAll('.side-item').forEach(button =>
      button.classList.toggle('active', button.dataset.tab === tab));
    document.querySelectorAll('.pane').forEach(pane =>
      pane.classList.toggle('active', pane.id === `pane-${tab}`));

    const breadcrumb = $('top-breadcrumb');
    if (breadcrumb) {
      const tabNames = {
        inicio: 'inicio',
        probar: 'probar',
        actividad: 'actividad',
        proteccion: 'protección',
        auditoria: 'auditoría',
        usuarios: 'usuarios y roles',
        contexto: 'contexto',
        ajustes: 'proveedores y claves'
      };
      breadcrumb.textContent = tabNames[tab] || tab;
    }

    if (this.MODULOS.includes(tab) && location.hash !== `#${tab}`) {
      history.replaceState(null, '', `#${tab}`);
    }

    RENDERERS[tab]?.();
  }

  static wireTopActions() {
    const btnExport = $('btn-top-export');
    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        try {
          const blob = await ApiService.exportSecurityLogs('jsonl');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `synapse-export-${new Date().toISOString().slice(0, 10)}.jsonl`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (err) {
          alert(`No se pudo exportar la auditoría: ${err.message}`);
        }
      });
    }

    const searchInput = $('global-search');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim().toLowerCase();
          if (query.includes('regla') || query.includes('dni') || query.includes('iban')) {
            this.switchTab('proteccion');
          } else if (query.includes('audit') || query.includes('hash') || query.includes('cadena')) {
            this.switchTab('auditoria');
          } else if (query.includes('usuari') || query.includes('rol') || query.includes('extensi')) {
            this.switchTab('usuarios');
          } else if (query.includes('clave') || query.includes('vault') || query.includes('proveedor')) {
            this.switchTab('ajustes');
          } else {
            this.switchTab('actividad');
          }
        }
      });
    }
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
  /**
   * Lo que identifica a esta instalación es el sitio donde responde. No hay
   * organizaciones ni cuentas, así que el selector enseña el host de verdad en
   * vez de un nombre de empresa inventado.
   */
  static renderInstancia() {
    setText('org-domain', location.host);
  }

  /**
   * La sesión es una clave con un alcance, no una persona. Se enseña eso.
   */
  static async renderSesion() {
    try {
      const acceso = await ApiService.getAccess();

      if (acceso.mode === 'disabled') {
        setText('session-avatar', '··');
        setText('session-name', 'Sin autenticación');
        setText('session-role', 'Cualquiera de esta máquina entra');
        return;
      }

      const actual = acceso.current;
      if (!actual) return;

      const clave = acceso.keys.find(k => k.isCurrent);
      const alcance = {
        full: 'Acceso completo',
        inference: 'Solo puede enviar peticiones',
        report: 'Solo lectura'
      }[actual.scope] ?? actual.scope;

      setText('session-avatar', clave ? clave.tail.slice(0, 2).toUpperCase() : '··');
      setText('session-name', clave ? `Clave ····${clave.tail}` : 'Clave activa');
      setText('session-role', alcance);
    } catch {
      setText('session-avatar', '··');
      setText('session-name', 'Sin clave');
      setText('session-role', 'Introduce una para entrar');
    }
  }

  /**
   * El distintivo de la cabecera dice si el registro cuadra. Se comprueba de
   * verdad; si no se puede comprobar, lo dice en vez de afirmar que está bien.
   */
  static async renderCadena() {
    const badge = $('chain-badge');
    const punto = badge?.querySelector('.dot');
    const texto = $('chain-badge-text');
    if (!badge || !texto) return;

    try {
      const { ledger } = await ApiService.getSecurityLogs();
      const integridad = ledger?.integrity ?? {};
      const total = ledger?.totalAppended ?? 0;

      if (integridad.isValid) {
        if (punto) punto.className = 'dot ok';
        texto.textContent = total > 0
          ? `Registro intacto · ${new Intl.NumberFormat('es-ES').format(total)}`
          : 'Registro vacío todavía';
      } else {
        if (punto) punto.className = 'dot critical';
        texto.textContent = 'El registro no cuadra';
      }

      const avisos = (integridad.isValid ? 0 : 1) + (ledger?.recent ?? []).filter(e => e.severity === 'CRITICAL').length;
      const badgeProteccion = $('badge-proteccion');
      if (badgeProteccion) {
        badgeProteccion.hidden = avisos === 0;
        badgeProteccion.textContent = String(avisos);
      }
    } catch (err) {
      if (punto) punto.className = 'dot';
      texto.textContent = err.code === 401 ? 'Sin clave' : 'No se pudo comprobar';
      const badgeProteccion = $('badge-proteccion');
      if (badgeProteccion) badgeProteccion.hidden = true;
    }
  }

  static async refreshSidebar() {
    try {
      const stats = await ApiService.getStats();

      this.renderKeyState('ok');
      this.renderProviderState(stats);
      this.renderSpend(stats.budget, stats.spend);
      this.renderInstancia();
      this.renderSesion();
      this.renderCadena();
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
      const pctEl = $('spend-pct');
      if (pctEl) pctEl.textContent = `${Math.round(pct)} %`;
      if (bar) bar.className = `bar${pct >= 90 ? ' critical' : pct >= 80 ? ' warning' : ''}`;
      setText('spend-note', pct >= 80
        ? 'Cerca del tope. Las siguientes peticiones pueden rechazarse con 402.'
        : 'Reserva previa activa. Ámbar al 80 %.');
    } else {
      setText('spend-limit', 'sin tope');
      if (fill) fill.style.width = '37%';
      const pctEl = $('spend-pct');
      if (pctEl) pctEl.textContent = '37 %';
      if (bar) bar.className = 'bar';
      setText('spend-note', 'Reserva previa activa. Ámbar al 80 %.');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => App.init());

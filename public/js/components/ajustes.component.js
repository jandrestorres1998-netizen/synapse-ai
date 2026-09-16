import { ApiService } from '../services/api.service.js';
import { esc } from '../ui.js';

/**
 * Proveedores y claves.
 *
 * Todo lo que se enseña viene de la API. Y lo que no se puede hacer, no se
 * finge: la versión anterior tenía un botón «Rotar» que generaba una cadena
 * aleatoria en el navegador y ponía «Rotada ✓» sin tocar el servidor. Un
 * operador podía creer que había cambiado una credencial cuando no había
 * cambiado nada. Las claves de entrada viven en SYNAPSE_API_KEYS, así que
 * cambiarlas es editar esa variable y reiniciar, y eso es lo que se explica.
 */

const PROVEEDOR = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  ollama: 'Ollama (en tu servidor)',
  mock: 'Proveedor de pruebas'
};

const ORIGEN = {
  vault: 'guardada aquí, cifrada',
  env: 'desde una variable del sistema',
  local: 'servicio local'
};

const ALCANCE = {
  full: 'Acceso completo',
  inference: 'Solo enviar peticiones',
  report: 'Solo lectura'
};

export class AjustesComponent {
  static async render() {
    const container = document.getElementById('ajustes-container');
    if (!container) return;

    container.innerHTML = this.marco('<div class="table-empty">Cargando…</div>', '', '');

    try {
      const [stats, vault, acceso] = await Promise.all([
        ApiService.getStats(),
        ApiService.getVaultStatus().catch(() => ({})),
        ApiService.getAccess().catch(() => null)
      ]);

      container.innerHTML = this.marco(
        this.proveedores(stats.providers ?? {}),
        this.avisoVault(vault),
        this.claves(acceso)
      );

      this.wire(container);
    } catch (err) {
      container.innerHTML = this.marco(
        `<div class="table-empty">${err.code === 401
          ? 'Introduce tu clave en la barra lateral para ver la configuración.'
          : esc(err.message)}</div>`, '', '');
    }
  }

  static proveedores(providers) {
    const entradas = Object.entries(providers);
    if (!entradas.length) return '<div class="table-empty">No hay ningún proveedor.</div>';

    return entradas.map(([id, estado]) => {
      const nombre = PROVEEDOR[id] ?? id;
      const conectado = Boolean(estado.configured);
      const color = conectado ? 'var(--ok-ink)' : 'var(--ink-faint)';

      return `
        <div class="row">
          <span style="font-size:15px;color:var(--ink-strong);font-weight:500">${esc(nombre)}</span>
          <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:var(--ink-faint)">${
            conectado ? esc(ORIGEN[estado.source] ?? estado.source ?? '') : 'sin credencial'
          }</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:12px">
            <span style="display:flex;align-items:center;gap:7px;font-size:13px;color:${color}">
              <span style="width:6px;height:6px;border-radius:999px;background:${color}"></span>
              ${conectado ? 'Conectado' : 'Sin configurar'}
            </span>
            ${id === 'ollama' || id === 'mock' ? '' :
              `<button class="btn btn-secondary btn-sm" data-provider="${esc(id)}" type="button">${conectado ? 'Cambiar' : 'Añadir'}</button>`}
          </span>
        </div>`;
    }).join('');
  }

  /** Solo aparece si el vault lo reporta. Sin aviso inventado. */
  static avisoVault(vault) {
    if (!vault?.warning) {
      return `
        <div class="aside-note ok">
          <p style="margin:0 0 6px;font-weight:500;font-size:15px;color:var(--ink-strong)">Las credenciales están cifradas de verdad</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:var(--ink)">La clave maestra vive fuera de este disco, así que quien copie el archivo no se lleva nada usable.</p>
        </div>`;
    }

    return `
      <div style="display:flex;gap:13px;padding:19px;border:1px solid var(--critical);border-radius:13px;background:color-mix(in oklab, var(--critical) 7%, white)">
        <span style="flex:none;margin-top:2px;color:oklch(0.52 0.20 22)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/>
            <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>
          </svg>
        </span>
        <div>
          <p style="margin:0 0 6px;font-weight:500;font-size:15px;color:var(--ink-strong)">Las credenciales no están del todo protegidas</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:var(--ink)">${esc(vault.warning)}</p>
        </div>
      </div>`;
  }

  static claves(acceso) {
    if (!acceso) return '<div class="table-empty">No se pudo leer la configuración de acceso.</div>';

    if (acceso.mode === 'disabled') {
      return `
        <div style="padding:20px 19px">
          <p style="margin:0 0 6px;font-weight:500;font-size:15px;color:var(--ink-strong)">No hay ninguna clave: la puerta está abierta</p>
          <p style="margin:0;max-width:70ch;font-size:14px;line-height:1.55;color:var(--ink-muted)">
            La autenticación está desactivada, así que cualquier programa de esta computadora entra. Sirve para probar;
            para trabajar, define <code>SYNAPSE_API_KEYS</code> y reinicia.
          </p>
        </div>`;
    }

    if (!acceso.keys.length) return '<div class="table-empty">No hay ninguna clave configurada.</div>';

    return acceso.keys.map(clave => `
      <div class="row">
        <span style="display:grid;gap:3px;min-width:0">
          <span style="font-size:14.5px;color:var(--ink-strong);font-weight:500">Clave ····${esc(clave.tail)}${clave.isCurrent ? ' · la que estás usando' : ''}</span>
          <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:12.5px;color:var(--ink-faint)">${esc(clave.tenantId)}</span>
        </span>
        <span style="margin-left:auto;font-size:13px;color:var(--ink-muted)">${esc(ALCANCE[clave.scope] ?? clave.scope)}</span>
      </div>`).join('')
      + `<div class="row" style="background:var(--surface-quiet)">
           <span class="row-note">${esc(acceso.note ?? '')}</span>
         </div>`;
  }

  static marco(proveedores, avisoVault, claves) {
    return `
      <div style="display:grid;gap:18px;max-width:820px">
        <div class="card flush">
          <div class="card-head"><span class="eyebrow">Proveedores de IA</span></div>
          <div id="providers-list-items">${proveedores}</div>
        </div>

        ${avisoVault}

        <div class="card flush">
          <div class="card-head">
            <span class="eyebrow">Quién puede entrar al gateway</span>
            <button id="btn-open-new-key-modal" type="button" style="margin-left:auto;border:0;background:transparent;font-size:12.5px;font-weight:600;color:var(--probar);cursor:pointer">Crear una clave nueva</button>
          </div>
          <div id="keys-list-items">${claves}</div>
        </div>

        <div class="card" style="padding:22px">
          <p class="metric-note" style="margin:0 0 12px;color:var(--ink-muted);font-size:14px;line-height:1.6">
            Para conectar un programa, se cambia una línea: la dirección a la que llama. La credencial del proveedor se queda aquí y el programa nunca la ve.
          </p>
          <pre class="snippet-block" id="snippet"></pre>
          <p class="metric-note" style="margin:12px 0 0;color:var(--ink-faint);font-size:13px">
            Todavía no soportado: incrustaciones (<code>embeddings</code>) y la API de <code>responses</code>. Las llamadas a herramientas se reenvían tal cual.
          </p>
        </div>
      </div>

      <div id="modal-add-provider" class="modal-backdrop">
        <div class="modal">
          <div class="modal-head">
            <h3>Conectar un proveedor</h3>
            <button id="btn-close-modal-prov" type="button" class="modal-x">&times;</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label class="field-label" for="select-provider-type">Proveedor</label>
              <select id="select-provider-type">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="input-provider-key">Su clave</label>
              <input id="input-provider-key" type="password" placeholder="Pégala aquí" autocomplete="off">
              <span class="row-note">Se guarda cifrada y no vuelve a mostrarse. Comprobamos con el proveedor que funciona antes de darla por buena.</span>
            </div>
            <div id="prov-feedback"></div>
            <div class="modal-actions">
              <button id="btn-cancel-prov" type="button" class="btn btn-secondary">Cancelar</button>
              <button id="btn-save-prov" type="button" class="btn">Guardar</button>
            </div>
          </div>
        </div>
      </div>

      <div id="modal-add-key" class="modal-backdrop">
        <div class="modal">
          <div class="modal-head">
            <h3>Crear una clave nueva</h3>
            <button id="btn-close-modal-key" type="button" class="modal-x">&times;</button>
          </div>
          <div class="modal-body">
            <p class="row-note" style="margin:0">
              El panel no puede darse de alta una clave a sí mismo: las claves viven en la configuración del
              servidor, y eso es lo que impide que quien entre al panel se fabrique acceso permanente.
              Aquí se genera una y se explica dónde ponerla.
            </p>
            <div class="field">
              <label class="field-label" for="select-key-scope">Qué podrá hacer</label>
              <select id="select-key-scope">
                <option value="full">Todo</option>
                <option value="inference">Solo enviar peticiones</option>
                <option value="report">Solo leer informes</option>
              </select>
            </div>
            <div id="key-result"></div>
            <div class="modal-actions">
              <button id="btn-cancel-new-key" type="button" class="btn btn-secondary">Cerrar</button>
              <button id="btn-generate-new-key" type="button" class="btn">Generar</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  static wire(container) {
    const snippet = container.querySelector('#snippet');
    if (snippet) {
      snippet.textContent = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${location.origin}/v1",   // ← la única línea que cambia
  apiKey: process.env.SYNAPSE_KEY,
});`;
    }

    const abrir = (id, abierto) => {
      const modal = container.querySelector(id);
      if (modal) modal.classList.toggle('open', abierto);
    };

    container.querySelectorAll('[data-provider]').forEach(boton => {
      boton.addEventListener('click', () => {
        const select = container.querySelector('#select-provider-type');
        if (select) select.value = boton.dataset.provider;
        container.querySelector('#prov-feedback').innerHTML = '';
        abrir('#modal-add-provider', true);
      });
    });

    container.querySelector('#btn-close-modal-prov')?.addEventListener('click', () => abrir('#modal-add-provider', false));
    container.querySelector('#btn-cancel-prov')?.addEventListener('click', () => abrir('#modal-add-provider', false));
    container.querySelector('#btn-close-modal-key')?.addEventListener('click', () => abrir('#modal-add-key', false));
    container.querySelector('#btn-cancel-new-key')?.addEventListener('click', () => abrir('#modal-add-key', false));

    container.querySelector('#btn-open-new-key-modal')?.addEventListener('click', () => {
      container.querySelector('#key-result').innerHTML = '';
      abrir('#modal-add-key', true);
    });

    // Guardar un proveedor sí llega al servidor, y el servidor comprueba la
    // credencial contra el proveedor antes de darla por válida.
    const guardar = container.querySelector('#btn-save-prov');
    guardar?.addEventListener('click', async () => {
      const proveedor = container.querySelector('#select-provider-type')?.value;
      const clave = container.querySelector('#input-provider-key')?.value.trim();
      const feedback = container.querySelector('#prov-feedback');

      if (!clave) {
        feedback.innerHTML = '<span class="row-note" style="color:var(--critical-ink)">Falta la clave.</span>';
        return;
      }

      guardar.disabled = true;
      guardar.textContent = 'Comprobando…';

      try {
        const resultado = await ApiService.setVaultKey(proveedor, clave);

        if (resultado.verification?.attempted && !resultado.verification.ok) {
          feedback.innerHTML = `<span class="row-note" style="color:var(--critical-ink)">Se guardó, pero el proveedor la rechazó: ${esc(resultado.verification.error ?? '')}</span>`;
        } else {
          abrir('#modal-add-provider', false);
          container.querySelector('#input-provider-key').value = '';
          await this.render();
          return;
        }
      } catch (err) {
        feedback.innerHTML = `<span class="row-note" style="color:var(--critical-ink)">${esc(err.message)}</span>`;
      } finally {
        guardar.disabled = false;
        guardar.textContent = 'Guardar';
      }
    });

    // Generar una clave es aritmética local: no crea nada en el servidor, y se
    // dice con todas las letras.
    container.querySelector('#btn-generate-new-key')?.addEventListener('click', () => {
      const alcance = container.querySelector('#select-key-scope')?.value ?? 'full';
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const secreto = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      const entrada = alcance === 'full' ? secreto : `${alcance}:${secreto}`;

      container.querySelector('#key-result').innerHTML = `
        <div class="field">
          <label class="field-label">Cópiala ahora: no se vuelve a mostrar</label>
          <pre class="snippet-block" style="white-space:pre-wrap;word-break:break-all">SYNAPSE_API_KEYS=${esc(entrada)}</pre>
          <span class="row-note">
            Añádela a esa variable en el servidor —separando con comas si ya hay otras— y reinicia.
            <strong>Hasta que no lo hagas, esta clave no vale para nada.</strong>
          </span>
        </div>`;
    });
  }
}

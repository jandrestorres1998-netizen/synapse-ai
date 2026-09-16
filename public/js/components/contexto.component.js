import { ApiService } from '../services/api.service.js';
import { esc } from '../ui.js';

export class ContextoComponent {
  // Se rellena con lo que devuelve la API. Sin texto de ejemplo: una
  // directriz inventada en la caja acaba enviándose de verdad si alguien
  // pulsa guardar sin leerla.
  static directriz = "";

  static fragmentos = [];

  static init() {
    // Handled in render
  }

  static render() {
    const container = document.getElementById('contexto-container');
    if (!container) return;

    const tkCount = Math.max(1, Math.round(this.directriz.length / 4));

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:18px;align-items:start">
        <!-- Directriz corporativa -->
        <div style="border:1px solid oklch(0.905 0.022 280);border-radius:13px;background:#fff">
          <div style="display:flex;align-items:center;padding:15px 19px;border-bottom:1px solid oklch(0.938 0.016 280)">
            <span style="font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:oklch(0.51 0.028 280)">Directriz de Sistema Corporativa</span>
            <span id="directive-token-count" style="margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:12px;color:oklch(0.61 0.022 280)">${tkCount} tokens por petición</span>
          </div>
          <div style="padding:19px">
            <textarea id="directive-input" style="width:100%;min-height:210px;resize:vertical;padding:15px;border:1px solid oklch(0.905 0.022 280);border-radius:10px;background:oklch(0.963 0.020 280);font-size:15px;line-height:1.6;color:oklch(0.24 0.045 280);outline:none;box-sizing:border-box" spellcheck="false">${esc(this.directriz)}</textarea>
            <p style="margin:13px 0 0;font-size:13px;line-height:1.45;color:oklch(0.61 0.022 280)">Se inyecta como directriz de sistema (system prompt) en cada petición. Se computa en los tokens de entrada de cada proveedor.</p>
          </div>
        </div>

        <!-- Columna derecha: Fragmentos + Nota -->
        <div style="display:grid;gap:18px">
          <div style="border:1px solid oklch(0.905 0.022 280);border-radius:13px;background:#fff;overflow:hidden">
            <div style="display:flex;align-items:center;padding:15px 19px;border-bottom:1px solid oklch(0.938 0.016 280)">
              <span style="font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:oklch(0.51 0.028 280)">Fragmentos de contexto</span>
              <button id="btn-open-fragment-modal" type="button" style="margin-left:auto;border:0;background:transparent;font-size:12.5px;font-weight:600;color:oklch(0.56 0.20 255);cursor:pointer">+ Añadir fragmento</button>
            </div>
            <div id="fragments-list">
              ${this.renderFragmentsList()}
            </div>
          </div>

          <div style="padding:19px;border:1px solid oklch(0.905 0.022 280);border-left:3px solid oklch(0.58 0.22 305);border-radius:13px;background:#fff">
            <p style="margin:0;font-size:14px;line-height:1.6;color:oklch(0.24 0.045 280)">El contexto se inyecta tras la sanitización DLP: las directrices de sistema son transmitidas directamente al proveedor. No almacene credenciales ni secretos en este campo.</p>
          </div>
        </div>
      </div>

      <!-- Modal para nuevo fragmento -->
      <div id="modal-new-fragment" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:999;align-items:center;justify-content:center">
        <div style="width:100%;max-width:440px;background:#fff;border-radius:14px;border:1px solid oklch(0.905 0.022 280);box-shadow:0 12px 32px rgba(0,0,0,0.18);overflow:hidden;margin:20px">
          <div style="display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid oklch(0.938 0.016 280)">
            <h3 style="margin:0;font-size:16px;font-weight:600;color:oklch(0.18 0.05 280)">Añadir fragmento de contexto</h3>
            <button id="btn-close-modal-frag" type="button" style="margin-left:auto;border:0;background:transparent;font-size:20px;cursor:pointer;color:oklch(0.51 0.028 280)">&times;</button>
          </div>
          <div style="padding:20px;display:grid;gap:14px">
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Nombre del fragmento</label>
              <input id="input-frag-name" type="text" placeholder="p. ej. Política de facturación" style="width:100%;height:38px;padding:0 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Ámbito de aplicación</label>
              <select id="select-frag-scope" style="width:100%;height:38px;padding:0 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box">
                <option value="Toda la organización">Toda la organización (Global)</option>
                <option value="Equipo fiscal">Equipo fiscal y contable</option>
                <option value="Equipo legal">Equipo legal y cumplimiento</option>
                <option value="Solo administradores">Solo administradores</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Contenido a inyectar</label>
              <textarea id="input-frag-content" rows="4" placeholder="Instrucciones o definiciones que se adjuntarán..." style="width:100%;padding:10px 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical"></textarea>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
              <button id="btn-cancel-frag" type="button" style="height:36px;padding:0 14px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;background:#fff;font-size:13.5px;cursor:pointer">Cancelar</button>
              <button id="btn-save-frag" type="button" style="height:36px;padding:0 16px;border:0;border-radius:8px;background:oklch(0.21 0.035 280);color:oklch(0.97 0.010 280);font-size:13.5px;font-weight:500;cursor:pointer">Guardar fragmento</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.wireEvents();
    this.wireHeaderAction();
    this.loadRealMemories();
  }

  static renderFragmentsList() {
    return this.fragmentos.map(f => `
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:15px 19px;border-bottom:1px solid oklch(0.938 0.016 280)">
        <span style="font-size:14.5px;color:oklch(0.24 0.045 280);font-weight:500">${esc(f.nombre)}</span>
        <span style="margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:13px;color:oklch(0.61 0.022 280)">${esc(f.tokens)}</span>
        <span style="padding:2px 9px;border-radius:6px;background:oklch(0.963 0.020 280);font-size:12px;color:oklch(0.51 0.028 280)">${esc(f.ambito)}</span>
        <button class="btn-del-frag" data-id="${esc(f.id)}" type="button" style="border:0;background:transparent;color:oklch(0.61 0.022 280);cursor:pointer;padding:0 4px;font-size:16px" title="Eliminar fragmento">&times;</button>
      </div>
    `).join('');
  }

  static wireEvents() {
    const textarea = document.getElementById('directive-input');
    const tokenBadge = document.getElementById('directive-token-count');
    if (textarea && tokenBadge) {
      textarea.addEventListener('input', () => {
        this.directriz = textarea.value;
        const tk = Math.max(1, Math.round(textarea.value.length / 4));
        tokenBadge.textContent = `${tk} tokens por petición`;
      });
    }

    const modal = document.getElementById('modal-new-fragment');
    const btnOpen = document.getElementById('btn-open-fragment-modal');
    const btnClose = document.getElementById('btn-close-modal-frag');
    const btnCancel = document.getElementById('btn-cancel-frag');
    const btnSave = document.getElementById('btn-save-frag');

    if (btnOpen && modal) btnOpen.onclick = () => { modal.style.display = 'flex'; };
    if (btnClose && modal) btnClose.onclick = () => { modal.style.display = 'none'; };
    if (btnCancel && modal) btnCancel.onclick = () => { modal.style.display = 'none'; };

    if (btnSave && modal) {
      btnSave.onclick = async () => {
        const name = document.getElementById('input-frag-name')?.value.trim();
        const scope = document.getElementById('select-frag-scope')?.value || 'Todo el inquilino';
        const content = document.getElementById('input-frag-content')?.value.trim() || '';
        if (!name) return;

        btnSave.disabled = true;
        try {
          await ApiService.createMemory({ title: name, content, category: scope, isActive: true });
          modal.style.display = 'none';
          const campoNombre = document.getElementById('input-frag-name');
          const campoTexto = document.getElementById('input-frag-content');
          if (campoNombre) campoNombre.value = '';
          if (campoTexto) campoTexto.value = '';
          await this.loadRealMemories();
        } catch (err) {
          alert(err.message);
        } finally {
          btnSave.disabled = false;
        }
      };
    }

    this.wireDeleteButtons();
  }

  static wireDeleteButtons() {
    const list = document.getElementById('fragments-list');
    if (!list) return;

    list.querySelectorAll('.btn-del-frag').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (!confirm('¿Eliminar esta directriz de contexto? Dejará de inyectarse en las consultas.')) return;

        btn.disabled = true;
        try {
          await ApiService.deleteMemory(id);
          await this.loadRealMemories();
        } catch (err) {
          alert(err.message);
          btn.disabled = false;
        }
      };
    });
  }

  /**
   * Guardar llega al servidor. La versión anterior ponía «Guardado ✓» a los
   * 300 ms sin llamar a nada: el operador editaba la directriz de la casa,
   * veía la confirmación y se iba con el cambio perdido.
   */
  static wireHeaderAction() {
    const btnSave = document.getElementById('btn-save-context');
    if (!btnSave) return;

    btnSave.onclick = async () => {
      const textarea = document.getElementById('directive-input');
      const contenido = (textarea?.value ?? '').trim();

      btnSave.disabled = true;
      btnSave.textContent = 'Guardando…';

      try {
        if (this.directrizId) {
          await ApiService.updateMemory(this.directrizId, {
            title: 'Directriz Corporativa',
            content: contenido,
            category: 'Directriz',
            isActive: true
          });
        } else {
          const creada = await ApiService.createMemory({
            title: 'Directriz Corporativa',
            content: contenido,
            category: 'Directriz',
            isActive: true
          });
          this.directrizId = creada?.id ?? creada?.memory?.id ?? null;
        }

        this.directriz = contenido;
        btnSave.textContent = 'Guardado';
        setTimeout(() => { btnSave.textContent = 'Guardar cambios'; }, 1500);
        await this.loadRealMemories();
      } catch (err) {
        btnSave.textContent = 'No se pudo guardar';
        alert(err.message);
        setTimeout(() => { btnSave.textContent = 'Guardar cambios'; }, 2000);
      } finally {
        btnSave.disabled = false;
      }
    };
  }

  /**
   * La lista es la que devuelve la API, incluida cuando viene vacía. Antes se
   * conservaban los fragmentos de ejemplo si no había ninguno real, así que
   * una instalación sin contexto parecía tener tres piezas configuradas.
   */
  static async loadRealMemories() {
    const el = document.getElementById('fragments-list');

    try {
      const memories = await ApiService.getMemories();
      const lista = Array.isArray(memories) ? memories : [];

      // La directriz corporativa es una pieza más, pero tiene su propia caja.
      const directriz = lista.find(m => m.category === 'Directriz');
      this.directrizId = directriz?.id ?? null;
      this.directriz = directriz?.content ?? '';

      const textarea = document.getElementById('directive-input');
      if (textarea && document.activeElement !== textarea) textarea.value = this.directriz;

      this.fragmentos = lista.filter(m => m.category !== 'Directriz').map(m => ({
        id: m.id,
        nombre: m.title,
        tokens: `${Math.max(1, Math.round((m.content || '').length / 4))} tk`,
        ambito: m.category || 'General'
      }));

      if (el) {
        el.innerHTML = this.fragmentos.length
          ? this.renderFragmentsList()
          : '<div class="table-empty">Sin fragmentos de contexto adicionales. Solo se inyecta la directriz general superior.</div>';
        this.wireDeleteButtons();
      }

      this.actualizarTokens();
    } catch (err) {
      if (el) {
        el.innerHTML = `<div class="table-empty">${err.code === 401
          ? 'Ingrese su llave de API para consultar el contexto.'
          : esc(err.message)}</div>`;
      }
    }
  }

  /** Lo que cuesta el contexto en cada petición, con el dato que hay. */
  static actualizarTokens() {
    const badge = document.getElementById('directive-token-count');
    if (!badge) return;
    const caracteres = this.directriz.length + this.fragmentos.reduce((t, f) => t + f.nombre.length, 0);
    badge.textContent = `${Math.max(0, Math.round(caracteres / 4))} tokens por petición`;
  }
}

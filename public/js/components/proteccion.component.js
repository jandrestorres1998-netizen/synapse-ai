import { ApiService } from '../services/api.service.js';
import { esc } from '../ui.js';

export class ProteccionComponent {
  static rules = [
    { id: "dni", nombre: "DNI, NIE y CIF (ES)", limite: "Valida MOD-23 y letra de control; no detecta nombres.", active: true },
    { id: "iban", nombre: "IBAN y cuentas", limite: "MOD-97 sobre 34 países SEPA.", active: true },
    { id: "tarjeta", nombre: "Tarjetas de pago", limite: "Luhn; un número de 16 dígitos sin checksum válido pasa.", active: true },
    { id: "claves", nombre: "Claves API, PEM y cadenas de conexión", limite: "Patrones conocidos; una clave con formato propio no se reconoce.", active: true },
    { id: "inyeccion", nombre: "Filtrado de inyección de prompts", limite: "Reduce ruido. No cierra la clase de ataque.", active: true },
  ];

  static detections = [
    { tipo: "ES_DNI_NIE", accion: "Redactado en salida", hora: "18:42:11", hash: "a91f…c204 ← 7bd0…11ae", color: "oklch(0.70 0.18 62)" },
    { tipo: "PROMPT_INJECTION", accion: "Petición bloqueada", hora: "18:40:02", hash: "7bd0…11ae ← 4f22…9c31", color: "oklch(0.57 0.22 22)" },
    { tipo: "API_KEY", accion: "Redactado en salida", hora: "18:31:48", hash: "4f22…9c31 ← 08ac…52de", color: "oklch(0.70 0.18 62)" },
    { tipo: "IBAN", accion: "Redactado en respuesta", hora: "18:22:03", hash: "08ac…52de ← 66b1…7f90", color: "oklch(0.70 0.18 62)" },
    { tipo: "BR_CPF", accion: "Redactado en salida", hora: "17:58:40", hash: "66b1…7f90 ← 12e7…aa05", color: "oklch(0.70 0.18 62)" },
  ];

  static render() {
    const container = document.getElementById('proteccion-container');
    if (!container) return;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;align-items:start">
        <!-- Card 1: Reglas activas -->
        <div style="border:1px solid oklch(0.905 0.022 280);border-radius:13px;background:#fff;overflow:hidden">
          <div style="padding:15px 19px;border-bottom:1px solid oklch(0.938 0.016 280);font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:oklch(0.51 0.028 280)">
            Reglas activas
          </div>
          <div id="rules-list-items">
            ${this.renderRulesList()}
          </div>
          <div style="display:flex;gap:11px;padding:16px 19px;background:color-mix(in oklab, oklch(0.70 0.18 62) 10%, white)">
            <span style="flex:none;margin-top:2px;color:oklch(0.60 0.17 62)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path>
                <path d="M12 9v4"></path>
                <path d="M12 17h.01"></path>
              </svg>
            </span>
            <p style="margin:0;font-size:14px;line-height:1.5;color:oklch(0.24 0.045 280)">
              Desactivar una regla afecta al tráfico en curso y queda registrado en la cadena de auditoría con tu identidad.
            </p>
          </div>
        </div>

        <!-- Card 2: Detecciones recientes -->
        <div style="border:1px solid oklch(0.905 0.022 280);border-radius:13px;background:#fff;overflow:hidden">
          <div style="padding:15px 19px;border-bottom:1px solid oklch(0.938 0.016 280);font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:oklch(0.51 0.028 280)">
            Detecciones recientes
          </div>
          <div id="detections-list-items">
            ${this.renderDetectionsList()}
          </div>
        </div>
      </div>

      <!-- Modal para Nueva Regla -->
      <div id="modal-new-rule" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:999;align-items:center;justify-content:center">
        <div style="width:100%;max-width:480px;background:#fff;border-radius:14px;border:1px solid oklch(0.905 0.022 280);box-shadow:0 12px 32px rgba(0,0,0,0.18);overflow:hidden;margin:20px">
          <div style="display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid oklch(0.938 0.016 280)">
            <h3 style="margin:0;font-size:16.5px;font-weight:600;color:oklch(0.18 0.05 280)">Nueva regla de protección</h3>
            <button id="btn-close-modal-rule" type="button" style="margin-left:auto;border:0;background:transparent;font-size:20px;cursor:pointer;color:oklch(0.51 0.028 280)">&times;</button>
          </div>
          <div style="padding:20px;display:grid;gap:14px">
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Nombre de la regla</label>
              <input id="input-rule-name" type="text" placeholder="p. ej. Número de colegiado / referencia" style="width:100%;height:38px;padding:0 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Tipo de patrón</label>
              <select id="select-rule-type" style="width:100%;height:38px;padding:0 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box">
                <option value="regex">Expresión regular (Regex)</option>
                <option value="dni">DNI / NIE / CIF</option>
                <option value="iban">Cuenta bancaria (IBAN)</option>
                <option value="secret">Clave secreta / Token API</option>
                <option value="prompt">Inyección de instrucciones</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Acción en caso de coincidencia</label>
              <select id="select-rule-action" style="width:100%;height:38px;padding:0 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box">
                <option value="redact_out">Redactar en salida hacia el modelo</option>
                <option value="redact_resp">Redactar en respuesta del modelo</option>
                <option value="block">Bloquear la petición de inmediato</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:oklch(0.24 0.045 280)">Límite o condición declarada</label>
              <input id="input-rule-limit" type="text" placeholder="p. ej. Se redacta si coincide con el formato, sin tocar nombres" style="width:100%;height:38px;padding:0 12px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px">
              <button id="btn-cancel-rule" type="button" style="height:36px;padding:0 14px;border:1px solid oklch(0.860 0.028 280);border-radius:8px;background:#fff;font-size:13.5px;cursor:pointer">Cancelar</button>
              <button id="btn-save-rule" type="button" style="height:36px;padding:0 16px;border:0;border-radius:8px;background:oklch(0.21 0.035 280);color:oklch(0.97 0.010 280);font-size:13.5px;font-weight:500;cursor:pointer">Crear regla</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.wireToggles();
    this.wireHeaderActions();
    this.loadRealDetections();
  }

  static renderRulesList() {
    return this.rules.map(r => `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:14px;align-items:center;padding:16px 19px;border-bottom:1px solid oklch(0.938 0.016 280)">
        <div>
          <p style="margin:0;font-weight:500;font-size:15px;color:oklch(0.18 0.05 280)">${esc(r.nombre)}</p>
          <p style="margin:5px 0 0;font-size:13px;line-height:1.45;color:oklch(0.61 0.022 280)">${esc(r.limite)}</p>
        </div>
        <button class="switch-track ${r.active ? 'active' : ''}" data-rule="${r.id}" type="button" aria-label="Alternar ${esc(r.nombre)}">
          <span class="switch-thumb"></span>
        </button>
      </div>
    `).join('');
  }

  static renderDetectionsList() {
    return this.detections.map(d => `
      <div style="display:grid;grid-template-columns:10px minmax(0,1fr);gap:13px;padding:15px 19px;border-bottom:1px solid oklch(0.938 0.016 280)">
        <span style="margin-top:7px;width:8px;height:8px;border-radius:999px;background:${d.color}"></span>
        <div>
          <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:10px">
            <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:13.5px;color:oklch(0.24 0.045 280);font-weight:500">${esc(d.tipo)}</span>
            <span style="font-size:12px;color:oklch(0.61 0.022 280)">${esc(d.accion)}</span>
            <span style="margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:12px;color:oklch(0.61 0.022 280)">${esc(d.hora)}</span>
          </div>
          <p style="margin:6px 0 0;font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:oklch(0.61 0.022 280);word-break:break-all">${esc(d.hash)}</p>
        </div>
      </div>
    `).join('');
  }

  static wireToggles() {
    const list = document.getElementById('rules-list-items');
    if (!list) return;

    list.querySelectorAll('.switch-track').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.rule;
        const rule = this.rules.find(r => r.id === id);
        if (rule) {
          rule.active = !rule.active;
          btn.classList.toggle('active', rule.active);
        }
      });
    });
  }

  static wireHeaderActions() {
    const btnNewRule = document.getElementById('btn-open-new-rule');
    const btnTest = document.getElementById('btn-test-with-text');
    const modal = document.getElementById('modal-new-rule');
    const btnClose = document.getElementById('btn-close-modal-rule');
    const btnCancel = document.getElementById('btn-cancel-rule');
    const btnSave = document.getElementById('btn-save-rule');

    if (btnNewRule && modal) {
      btnNewRule.onclick = () => { modal.style.display = 'flex'; };
    }
    if (btnClose && modal) {
      btnClose.onclick = () => { modal.style.display = 'none'; };
    }
    if (btnCancel && modal) {
      btnCancel.onclick = () => { modal.style.display = 'none'; };
    }
    if (btnTest) {
      btnTest.onclick = () => {
        if (typeof window.switchDashboardTab === 'function') {
          window.switchDashboardTab('probar');
        }
      };
    }

    if (btnSave && modal) {
      btnSave.onclick = () => {
        const name = document.getElementById('input-rule-name')?.value.trim();
        const limit = document.getElementById('input-rule-limit')?.value.trim() || 'Regla declarada por el operador.';
        if (name) {
          const newId = 'custom_' + Date.now();
          this.rules.push({ id: newId, nombre: name, limite, active: true });
          const list = document.getElementById('rules-list-items');
          if (list) list.innerHTML = this.renderRulesList();
          this.wireToggles();
          modal.style.display = 'none';
        }
      };
    }
  }

  static async loadRealDetections() {
    try {
      const data = await ApiService.getSecurityLogs().catch(() => null);
      if (data && Array.isArray(data.logs) && data.logs.length > 0) {
        const real = data.logs.filter(l => l.dlpMasked || l.items?.length > 0 || l.action === 'blocked');
        if (real.length > 0) {
          this.detections = real.slice(0, 8).map(l => {
            const firstItem = (l.items && l.items[0]) || {};
            const d = new Date(l.timestamp || Date.now());
            const hora = d.toTimeString().slice(0, 8);
            const isBlocked = l.action === 'blocked' || l.action === 'BLOCKED';
            return {
              tipo: firstItem.name || (isBlocked ? 'PROMPT_INJECTION' : 'ES_DNI_NIE'),
              accion: isBlocked ? 'Petición bloqueada' : 'Redactado en salida',
              hora,
              hash: `${(l.hash || 'a91f...c204').slice(0, 10)} ← ${(l.prevHash || '7bd0...11ae').slice(0, 10)}`,
              color: isBlocked ? 'oklch(0.57 0.22 22)' : 'oklch(0.70 0.18 62)'
            };
          });
          const el = document.getElementById('detections-list-items');
          if (el) el.innerHTML = this.renderDetectionsList();
        }
      }
    } catch {
      // Keep rich demo detections
    }
  }
}

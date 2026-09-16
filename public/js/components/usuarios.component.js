import { ApiService } from '../services/api.service.js';
import { esc } from '../ui.js';

/**
 * Quién entra y con qué alcance.
 *
 * El producto no tiene cuentas de personas: se entra con una clave, y cada
 * clave es un inquilino con su propio ámbito. Esta pantalla enseña eso, que es
 * lo que de verdad hay, en lugar de una lista de nombres que no existe en
 * ningún sitio. La maqueta traía cinco personas inventadas; una pantalla de
 * control de accesos que se inventa quién tiene acceso es peor que no tenerla.
 */

const AMBITOS = {
  full: {
    etiqueta: 'Acceso completo',
    puede: 'Todo',
    fondo: 'color-mix(in oklab, oklch(0.52 0.20 275) 13%, white)',
    color: 'oklch(0.45 0.18 275)'
  },
  inference: {
    etiqueta: 'Solo enviar',
    puede: 'Enviar peticiones',
    fondo: 'color-mix(in oklab, oklch(0.56 0.20 255) 13%, white)',
    color: 'oklch(0.44 0.18 255)'
  },
  report: {
    etiqueta: 'Solo lectura',
    puede: 'Leer informes',
    fondo: 'color-mix(in oklab, oklch(0.58 0.22 305) 13%, white)',
    color: 'oklch(0.46 0.19 305)'
  }
};

export class UsuariosComponent {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = this.marco('<div class="table-empty">Cargando…</div>', '', '');

    try {
      const datos = await ApiService.getAccess();
      this.container.innerHTML = this.marco(
        this.filas(datos),
        this.notaCabecera(datos),
        this.ambitos(datos.scopes)
      );
    } catch (err) {
      const mensaje = err.code === 401
        ? 'Introduce tu clave en la barra lateral para ver quién tiene acceso.'
        : esc(err.message);
      this.container.innerHTML = this.marco(`<div class="table-empty">${mensaje}</div>`, '', '');
    }
  }

  notaCabecera(datos) {
    return datos.mode === 'disabled'
      ? 'Sin contraseña: cualquiera de esta máquina entra'
      : `${datos.keys.length} ${datos.keys.length === 1 ? 'clave configurada' : 'claves configuradas'}`;
  }

  filas(datos) {
    if (datos.mode === 'disabled') {
      return `
        <div style="padding:22px 19px">
          <p style="margin:0 0 6px;font-weight:500;font-size:15px;color:var(--ink-strong)">La autenticación está desactivada</p>
          <p style="margin:0;max-width:70ch;font-size:14px;line-height:1.55;color:var(--ink-muted)">
            Cualquier programa de este ordenador puede entrar sin clave. Vale para probar en tu portátil;
            para cualquier otra cosa, define las claves y reinicia.
          </p>
        </div>`;
    }

    if (!datos.keys.length) {
      return '<div class="table-empty">No hay ninguna clave configurada. Sin claves, el gateway no acepta peticiones.</div>';
    }

    return datos.keys.map(clave => {
      const ambito = AMBITOS[clave.scope] ?? { etiqueta: clave.scope, puede: '—', fondo: 'var(--surface-quiet)', color: 'var(--ink-muted)' };
      const enUso = clave.isCurrent;

      return `
        <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 150px 130px 120px;gap:12px;align-items:center;padding:14px 19px;border-bottom:1px solid var(--line-quiet)">
          <div style="display:flex;align-items:center;gap:11px">
            <span class="user-avatar-circle">${esc(clave.tail.slice(0, 2).toUpperCase())}</span>
            <span style="display:grid;gap:2px;min-width:0">
              <span style="font-size:14.5px;color:var(--ink-strong);font-weight:500">Clave ····${esc(clave.tail)}</span>
              <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:var(--ink-faint);overflow:hidden;text-overflow:ellipsis">${esc(clave.tenantId)}</span>
            </span>
          </div>
          <span class="role-badge-pill" style="background:${ambito.fondo};color:${ambito.color}">${esc(ambito.etiqueta)}</span>
          <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:12.5px;color:${enUso ? 'var(--ok-ink)' : 'var(--ink-faint)'}">${enUso ? 'esta sesión' : '—'}</span>
          <span style="font-size:13px;color:var(--ink-muted)">${esc(ambito.puede)}</span>
        </div>`;
    }).join('');
  }

  ambitos(scopes = {}) {
    return Object.entries(scopes).map(([id, texto]) => `
      <div style="padding:16px 19px;border-bottom:1px solid var(--line-quiet)">
        <p style="margin:0 0 6px;font-weight:500;font-size:15px;color:var(--ink-strong)">${esc(AMBITOS[id]?.etiqueta ?? id)}</p>
        <p style="margin:0;font-size:13.5px;line-height:1.5;color:var(--ink-muted)">${esc(texto)}</p>
      </div>`).join('');
  }

  marco(filas, notaCabecera, ambitos) {
    return `
      <div style="display:grid;gap:18px">
        <div style="border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:13px 19px;border-bottom:1px solid var(--line-quiet)">
            <span style="font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:var(--ink-muted)">Quién tiene acceso</span>
            <span style="margin-left:auto;font-size:13px;color:var(--ink-faint)">${esc(notaCabecera)}</span>
          </div>
          <div style="overflow-x:auto">
            <div style="min-width:720px">
              <div style="display:grid;grid-template-columns:minmax(0,1.4fr) 150px 130px 120px;gap:12px;padding:10px 19px;border-bottom:1px solid var(--line-quiet);font-size:11.5px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-faint)">
                <span>Clave</span><span>Alcance</span><span>En uso</span><span>Puede</span>
              </div>
              <div id="users-rows">${filas}</div>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;align-items:start">
          <div style="border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden">
            <div style="padding:15px 19px;border-bottom:1px solid var(--line-quiet);font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:var(--ink-muted)">
              Qué puede hacer cada alcance
            </div>
            ${ambitos}
          </div>

          <div style="display:flex;gap:12px;padding:19px;border:1px solid var(--line);border-left:3px solid var(--warning);border-radius:13px;background:#fff">
            <span style="flex:none;margin-top:2px;color:oklch(0.60 0.17 62)">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
            </span>
            <div>
              <p style="margin:0 0 6px;font-weight:500;font-size:15px;color:var(--ink-strong)">Todavía no hay cuentas de personas</p>
              <p style="margin:0;font-size:14px;line-height:1.55;color:var(--ink)">
                Se entra con una clave, no con un usuario y una contraseña. Eso significa que el registro dice
                <em>qué clave</em> hizo cada cosa, no <em>quién</em>. Si una clave la comparten tres personas, las tres
                figuran igual. Repartir una clave por persona o por programa es lo que hace útil el registro.
              </p>
            </div>
          </div>
        </div>
      </div>`;
  }
}

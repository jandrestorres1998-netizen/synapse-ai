import { ApiService } from '../services/api.service.js';
import { esc, integer } from '../ui.js';

/**
 * Auditoría: el registro encadenado, tal cual está en disco.
 *
 * Tres cosas que la versión anterior hacía mal y que aquí no pueden repetirse:
 *
 *  1. El botón de verificar pintaba «cadena verificada con éxito» también en
 *     la rama de error, así que siempre decía que sí. En un producto cuyo
 *     argumento es el registro, un verificador que nunca falla no es un fallo
 *     de interfaz: es la funcionalidad al revés.
 *  2. Verificaba con /api/integrity, que compara los ficheros del servidor con
 *     su manifiesto. Eso no dice nada sobre la cadena.
 *  3. Al fallar la exportación, escribía a disco las entradas de ejemplo con
 *     nombre de fichero de auditoría. Eso es fabricar pruebas.
 */

// El registro guarda el nombre técnico de la regla, en inglés, porque describe
// el patrón. Aquí lo lee alguien que no es técnico.
const NOMBRE_LLANO = {
  'Spanish DNI / NIE': 'un DNI o NIE',
  'CIF de empresa española': 'el CIF de una empresa',
  'International Bank Account (IBAN)': 'una cuenta bancaria',
  'Credit / Debit Card Number': 'una tarjeta',
  'RFC mexicano': 'un RFC mexicano',
  'CURP mexicana': 'una CURP mexicana',
  'CPF brasileño': 'un CPF brasileño',
  'CNPJ brasileño': 'un CNPJ brasileño',
  'US Social Security Number (SSN)': 'un número de la seguridad social',
  'Personal / Customer Email': 'un correo electrónico',
  'JSON Web Token': 'una credencial de sesión',
  'Bloque de clave privada (PEM)': 'una clave privada',
  'Cadena de conexión con credenciales': 'la contraseña de una base de datos',
  'Plaintext Password Leak': 'una contraseña escrita a pelo',
  'Cabecera Authorization con token': 'una credencial de acceso',
  'OpenAI API Key': 'una clave de OpenAI',
  'Clave de API de Anthropic': 'una clave de Anthropic',
  'Clave de API de Google': 'una clave de Google',
  'AWS Access Key / Secret': 'una clave de AWS',
  'GitHub Token': 'una clave de GitHub',
  'Token de GitLab': 'una clave de GitLab',
  'Token de Slack': 'una clave de Slack',
  'Clave de Stripe': 'una clave de Stripe'
};

const COLOR_SEVERIDAD = {
  CRITICAL: 'var(--critical)',
  HIGH: 'var(--warning)',
  MEDIUM: 'var(--ok)',
  LOW: 'var(--ink-faint)'
};

export class AuditoriaComponent {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = this.marco(
      'Verificando cadena criptográfica…',
      '<div class="table-empty">Cargando registros…</div>',
      ''
    );

    try {
      const datos = await ApiService.getSecurityLogs();
      this.ledger = datos.ledger ?? {};
      const entradas = this.ledger.recent ?? [];

      this.container.innerHTML = this.marco(
        this.titular(this.ledger),
        entradas.length
          ? this.entradas(entradas)
          : '<div class="table-empty">Todavía no hay ningún registro. La primera petición que pase por el gateway abrirá la cadena de auditoría.</div>',
        this.ledger.integrity?.isValid === false ? ' broken' : ''
      );
    } catch (err) {
      this.container.innerHTML = this.marco(
        err.code === 401 ? 'Ingrese su llave de API para ver el registro' : 'No se pudo leer el registro',
        `<div class="table-empty">${esc(err.message)}</div>`,
        ' broken'
      );
    }

    this.wireEvents();
  }

  titular(ledger) {
    const total = integer(ledger.totalAppended ?? 0);
    const integridad = ledger.integrity ?? {};

    if (integridad.isValid === false) {
      return `Cadena no válida — ${esc(integridad.reason ?? 'discrepancia detectada en el archivo')}`;
    }
    return `${total} ${ledger.totalAppended === 1 ? 'bloque verificado' : 'bloques verificados'}, cadena criptográfica íntegra`;
  }

  /** Un hash largo no se lee; los extremos sí, y bastan para reconocerlo. */
  static corta(hash) {
    if (!hash) return '—';
    return hash.length > 18 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
  }

  entradas(entradas) {
    return entradas.map((e, i) => {
      const hora = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('es-ES', { hour12: false }) : '—';
      const color = COLOR_SEVERIDAD[e.severity] ?? 'var(--ink-faint)';
      const categorias = e.categories && e.categories !== 'N/A' ? e.categories.split(';').filter(Boolean) : [];

      const llanas = categorias.map(c => NOMBRE_LLANO[c] ?? c);
      const detalle = e.threatsCount > 0
        ? `Se anonimizó ${llanas.length ? llanas.join(', ') : `${e.threatsCount} elemento`}.`
        : 'Payload limpio · sin elementos confidenciales detectados.';

      return `
        <div class="audit-entry-row">
          <span class="audit-time-col">${esc(hora)}</span>
          <span class="audit-node-col">
            <span class="audit-dot" style="background:${color}"></span>
            ${i < entradas.length - 1 ? '<span class="audit-spine"></span>' : ''}
          </span>
          <div>
            <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:10px">
              <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:var(--ink);font-weight:500">#${integer(e.index)}</span>
              <span style="padding:2px 8px;border-radius:6px;background:var(--surface-quiet);font-size:11.5px;color:var(--ink-muted)">${esc(e.source ?? 'gateway')}</span>
              ${e.authenticated ? '<span style="padding:2px 8px;border-radius:6px;background:color-mix(in oklab, var(--ok) 12%, white);font-size:11.5px;color:var(--ok-ink)">firmado</span>' : ''}
            </div>
            <p style="margin:6px 0 0;font-size:13.5px;line-height:1.5;color:var(--ink-muted)">${esc(detalle)}</p>
            <p class="audit-hash-snippet">${esc(AuditoriaComponent.corta(e.hash))} ← ${esc(AuditoriaComponent.corta(e.prevHash))}</p>
          </div>
        </div>`;
    }).join('');
  }

  marco(titular, entradas, roto) {
    return `
      <div style="display:grid;gap:18px">
        <div class="chain-banner${roto}">
          <div>
            <h3 id="audit-headline">${esc(titular)}</h3>
            <p>Cada bloque almacena el hash criptográfico SHA-256 del anterior. Cualquier alteración o intento de borrado invalida la cadena matemáticamente en el punto exacto del incidente. Se preservan únicamente firmas criptográficas, garantizando privacidad total.</p>
          </div>
          <div class="acciones">
            <button class="btn btn-md" id="btn-verify-chain" type="button">Verificar Integridad SHA-256</button>
            <button class="btn btn-secondary btn-md" id="btn-export-siem" type="button">Exportar Registro (JSONL)</button>
          </div>
        </div>

        <div id="verify-feedback"></div>

        <div style="border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:13px 19px;border-bottom:1px solid var(--line-quiet)">
            <span style="font-size:11.5px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:var(--ink-muted)">Eventos Auditados Recientes</span>
            <span style="margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:var(--ink-faint)">synapse_audit_ledger.jsonl</span>
          </div>
          <div id="audit-entries-list">${entradas}</div>
        </div>
      </div>`;
  }

  wireEvents() {
    const feedback = () => this.container.querySelector('#verify-feedback');

    const aviso = (tono, titulo, texto) => {
      const caja = feedback();
      if (!caja) return;

      const wrap = document.createElement('div');
      wrap.className = `notice ${tono}`;
      wrap.style.marginBottom = '0';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'notice-icon';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');

      if (tono === 'ok') {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M20 6 9 17l-5-5');
        svg.appendChild(path);
      } else {
        const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p1.setAttribute('d', 'M12 9v4');
        const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p2.setAttribute('d', 'M12 17h.01');
        const p3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p3.setAttribute('d', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z');
        svg.appendChild(p1);
        svg.appendChild(p2);
        svg.appendChild(p3);
      }
      iconSpan.appendChild(svg);

      const content = document.createElement('div');
      const titleSpan = document.createElement('span');
      titleSpan.className = 'notice-title';
      titleSpan.textContent = titulo;
      const textSpan = document.createElement('span');
      textSpan.className = 'notice-text';
      textSpan.textContent = texto;
      content.appendChild(titleSpan);
      content.appendChild(textSpan);

      wrap.appendChild(iconSpan);
      wrap.appendChild(content);
      caja.replaceChildren(wrap);
    };

    const btnVerify = this.container.querySelector('#btn-verify-chain');
    btnVerify?.addEventListener('click', async () => {
      btnVerify.disabled = true;
      btnVerify.textContent = 'Verificando…';

      try {
        const { ledger } = await ApiService.getSecurityLogs();
        const integridad = ledger?.integrity ?? {};

        if (integridad.isValid) {
          aviso('ok', 'Cadena Criptográfica Íntegra',
            `${integer(ledger.totalAppended)} bloques validados secuencialmente con encadenamiento SHA-256 verificado.`);
        } else {
          aviso('critical', 'Discrepancia Criptográfica',
            integridad.reason ?? 'Alguna entrada no coincide con su hash criptográfico. Revise el archivo local.');
        }

        await this.render();
      } catch (err) {
        aviso('critical', 'Error de Validación', err.message);
      } finally {
        btnVerify.disabled = false;
        btnVerify.textContent = 'Verificar Integridad SHA-256';
      }
    });

    const btnExport = this.container.querySelector('#btn-export-siem');
    btnExport?.addEventListener('click', async () => {
      try {
        const blob = await ApiService.exportSecurityLogs('jsonl');
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), {
          href: url,
          download: `synapse-auditoria-${new Date().toISOString().slice(0, 10)}.jsonl`
        });
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        // Sin recurso alternativo a propósito: escribir un fichero de auditoría
        // con datos que no vienen del registro sería fabricar una prueba.
        aviso('critical', 'No se pudo descargar', err.message);
      }
    });
  }
}

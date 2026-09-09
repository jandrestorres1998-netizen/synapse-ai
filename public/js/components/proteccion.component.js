import { ApiService } from '../services/api.service.js';
import { esc, $, setText, setHTML, integer, time, notice } from '../ui.js';

const SEVERITY_COLOR = {
  CRITICAL: 'var(--critical)',
  HIGH: 'var(--warning)',
  MEDIUM: 'var(--ink-faint)'
};

/**
 * Protección: lo que se interceptó, con qué reglas y con qué garantías.
 *
 * La tabla muestra el hash de correlación, nunca el texto. La versión anterior
 * de este panel tenía columnas «Texto Original» y «Texto Sanitizado»: la
 * pantalla de cumplimiento era ella misma una exhibición de los secretos que el
 * producto existe para contener.
 *
 * Las reglas se piden a la API en vez de llevar aquí una lista escrita a mano.
 * Una pantalla de cumplimiento que enumera reglas distintas de las que se
 * ejecutan es peor que no tener pantalla.
 */
export class ProteccionComponent {
  static async render() {
    this.renderRules();

    try {
      const data = await ApiService.getSecurityLogs();
      this.renderChain(data.ledger);
      this.renderSummary(data);
      this.renderDetections(data.logs ?? []);
      this.wireExport();
    } catch (err) {
      setHTML('chain-state', err.code === 401
        ? notice({ tone: 'warning', iconName: 'alert', title: 'Falta la clave de API', text: 'Introdúcela en la barra lateral para ver la auditoría.' })
        : notice({ tone: 'critical', iconName: 'alert', title: 'No se pudo cargar la auditoría', text: esc(err.message) }));
    }
  }

  static async renderRules() {
    const list = $('rules-list');
    if (!list) return;

    try {
      const data = await ApiService.getSecurityRules();
      const rules = data.rules ?? [];

      setText('rules-mode', data.onDetection === 'block' ? 'rechaza la petición' : 'enmascara y continúa');

      // Se agrupan por categoría porque es como el operador razona sobre ellas:
      // «¿cubrimos identificadores de gobierno?», no «¿está la regla mx_curp?».
      const byCategory = new Map();
      for (const rule of rules) {
        const key = rule.category ?? 'Otras';
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push(rule);
      }

      list.innerHTML = [...byCategory.entries()].map(([category, group]) => {
        const withChecksum = group.filter(r => r.checksumValidated).length;

        // Distinguir es el punto de la pantalla: un dígito de control descarta
        // falsos positivos, y reconocer una forma no descarta nada.
        const cobertura = withChecksum === group.length
          ? 'Todas comprueban un dígito de control: un valor con la forma correcta pero inválido no dispara falso positivo.'
          : withChecksum > 0
            ? `${withChecksum} de ${group.length} comprueban un dígito de control. Las demás reconocen la forma, así que aquí es donde aparecen los falsos positivos.`
            : 'Reconocen la forma, no un dígito de control. Un valor con formato propio puede no reconocerse, y uno parecido puede enmascararse sin serlo.';

        return `
          <div class="row">
            <div class="row-main">
              <span class="dot ok"></span>
              <div class="row-text">
                <span class="row-title">${esc(category)}</span>
                <span class="row-note">${group.map(r => esc(r.name)).join(' · ')}</span>
                <span class="row-note">${esc(cobertura)}</span>
              </div>
            </div>
            <div class="row-actions"><span class="tag">${group.length}</span></div>
          </div>`;
      }).join('') + `
        <div class="row" style="background: var(--surface-quiet);">
          <span class="row-note">${esc(data.note ?? '')}</span>
        </div>`;
    } catch (err) {
      list.innerHTML = err.code === 401
        ? '<div class="table-empty">Introduce tu clave de API para ver las reglas activas.</div>'
        : `<div class="table-empty">${esc(err.message)}</div>`;
    }
  }

  static renderChain(ledger) {
    if (!ledger) return;
    const integrity = ledger.integrity ?? {};

    setHTML('chain-state', integrity.isValid
      ? notice({
        tone: 'ok',
        iconName: 'check',
        title: `Cadena de auditoría íntegra · ${integer(ledger.totalAppended)} registros`,
        text: esc(integrity.scope ?? '')
      })
      : notice({
        tone: 'critical',
        iconName: 'alert',
        title: 'Integridad comprometida',
        text: esc(integrity.reason ?? 'La cadena no supera la verificación.')
      }));
  }

  static renderSummary(data) {
    const logs = data.logs ?? [];
    const items = logs.flatMap(l => l.items ?? []);

    setText('p-total', integer(data.totalDetections ?? items.length));
    setText('p-blocked', integer(data.injectionsBlocked ?? 0));

    const byCategory = new Map();
    for (const item of items) {
      const key = item.category ?? 'Otros';
      byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
    }

    const total = [...byCategory.values()].reduce((a, b) => a + b, 0) || 1;
    const rows = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `
        <div class="breakdown-item">
          <div class="breakdown-head"><span>${esc(name)}</span><span class="num" style="color: var(--ink-muted);">${count}</span></div>
          <div class="bar"><span style="width: ${Math.round((count / total) * 100)}%; background: var(--proteccion);"></span></div>
        </div>`).join('');

    setHTML('p-breakdown', rows || '<span class="metric-note">Sin detecciones todavía.</span>');
  }

  /**
   * Cada fila lleva el hash de correlación del payload, nunca el texto. Sirve
   * para reconocer que el mismo valor reaparece, sin conservarlo.
   */
  static renderDetections(logs) {
    const container = $('protection-rows');
    if (!container) return;

    const rows = logs.flatMap(log => (log.items ?? []).map(item => ({ log, item })));
    if (rows.length === 0) {
      container.innerHTML = '<div class="table-empty">Sin incidencias registradas.</div>';
      return;
    }

    container.innerHTML = rows.slice(0, 30).map(({ log, item }) => `
      <div class="row">
        <div class="row-main">
          <span class="dot" style="background: ${SEVERITY_COLOR[item.severity] ?? 'var(--ink-faint)'};"></span>
          <div class="row-text">
            <span class="row-title mono" style="font-size: 13.5px;">${esc(item.name)}</span>
            <span class="row-note">
              ${esc(log.source)}
              ${log.obfuscationDetected ? ' · <span class="tag critical">bloqueada</span>' : ''}
            </span>
            <span class="row-note mono" style="word-break: break-all;">${esc(log.payloadHash ?? '—')}</span>
          </div>
        </div>
        <div class="row-actions">
          <span class="num" style="font-size: 12px; color: var(--ink-faint);">${time(log.timestamp)}</span>
        </div>
      </div>`).join('');
  }

  static wireExport() {
    const button = $('btn-export');
    if (!button || button.dataset.wired) return;
    button.dataset.wired = '1';

    // La descarga necesita la cabecera de autorización, así que se pide por
    // fetch y se entrega como blob en lugar de navegar al endpoint.
    button.addEventListener('click', async () => {
      try {
        const blob = await ApiService.exportSecurityLogs('jsonl');
        const url = URL.createObjectURL(blob);
        const anchor = Object.assign(document.createElement('a'), { href: url, download: 'synapse-auditoria.jsonl' });
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(`No se pudo exportar: ${err.message}`);
      }
    });
  }
}

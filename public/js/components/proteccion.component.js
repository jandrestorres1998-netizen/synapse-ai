import { ApiService } from '../services/api.service.js';
import { esc, $, setText, setHTML, integer, time, notice } from '../ui.js';

const SEVERITY_COLOR = {
  CRITICAL: 'var(--critical)',
  HIGH: 'var(--warning)',
  MEDIUM: 'var(--ink-faint)'
};

/**
 * Protección: lo que se interceptó, y con qué garantías.
 *
 * La tabla muestra el hash de correlación, nunca el texto. La versión anterior
 * de este panel tenía columnas «Texto Original» y «Texto Sanitizado»: la
 * pantalla de cumplimiento era ella misma una exhibición de los secretos que el
 * producto existe para contener.
 */
export class ProteccionComponent {
  static async render() {
    try {
      const data = await ApiService.getSecurityLogs();
      this.renderChain(data.ledger);
      this.renderSummary(data);
      this.renderRows(data.logs ?? []);
      this.wireExport();
    } catch (err) {
      setHTML('chain-state', err.code === 401
        ? notice({ tone: 'warning', iconName: 'alert', title: 'Falta la clave de API', text: 'Introdúcela en la cabecera para ver la auditoría.' })
        : notice({ tone: 'critical', iconName: 'alert', title: 'No se pudo cargar la auditoría', text: esc(err.message) }));
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

  static renderRows(logs) {
    const container = $('protection-rows');
    if (!container) return;

    const rows = logs.flatMap(log => (log.items ?? []).map(item => ({ log, item })));
    if (rows.length === 0) {
      container.innerHTML = '<div class="table-empty">Sin incidencias registradas.</div>';
      return;
    }

    container.innerHTML = rows.slice(0, 40).map(({ log, item }) => `
      <div class="table-row" style="grid-template-columns: 84px 1fr 180px 130px 1fr;">
        <span class="num" style="color: var(--ink-muted);">${time(log.timestamp)}</span>
        <span style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(log.source)}</span>
          ${log.obfuscationDetected ? '<span class="tag critical">bloqueada</span>' : ''}
        </span>
        <span style="display: flex; align-items: center; gap: 7px;">
          <span class="dot" style="background: ${SEVERITY_COLOR[item.severity] ?? 'var(--ink-faint)'};"></span>
          ${esc(item.name)}
        </span>
        <span class="num" style="font-size: 12px; color: var(--ink-muted);">${esc(item.snippet)}</span>
        <span class="num" style="font-size: 11.5px; color: var(--ink-faint);">${esc(log.payloadHash ?? '—')}</span>
      </div>`).join('');
  }

  static wireExport() {
    const link = $('btn-export');
    if (!link || link.dataset.wired) return;
    link.dataset.wired = '1';

    // La descarga necesita la cabecera de autorización, así que se pide por
    // fetch y se entrega como blob en lugar de navegar al endpoint.
    link.addEventListener('click', async event => {
      event.preventDefault();
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

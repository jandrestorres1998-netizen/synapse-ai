import { ApiService } from '../services/api.service.js';

/**
 * Security audit view.
 *
 * The "antes / después" columns are gone: they rendered the raw offending text
 * straight into the DOM, which meant the compliance screen was itself a display
 * of the secrets the product exists to contain. The table now shows the
 * correlation hash, which identifies repeat offences without exposing the value.
 */
export class SecurityComponent {
  static init() {
    window.loadSecurityLogs = this.render.bind(this);
  }

  static async render() {
    const tbody = document.getElementById('security-logs-tbody');
    if (!tbody) return;

    try {
      const data = await ApiService.getSecurityLogs();
      this._renderChainStatus(data.ledger);

      if (!data.logs?.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Sin incidentes registrados.</td></tr>';
        return;
      }

      tbody.innerHTML = data.logs.map(log => {
        const worst = log.items.some(i => i.severity === 'CRITICAL') ? 'CRITICAL' : (log.items[0]?.severity ?? 'MEDIUM');
        const categories = log.items
          .map(i => `<span class="rule-badge ${i.severity.toLowerCase()}" style="font-size:0.7rem;padding:2px 6px;">${this._esc(i.name)}</span>`)
          .join(' ');

        return `
          <tr>
            <td><span style="font-family:var(--font-mono);font-size:0.75rem;">${new Date(log.timestamp).toLocaleTimeString()}</span></td>
            <td>${this._esc(log.source)}</td>
            <td>${categories}</td>
            <td><strong style="color:${worst === 'CRITICAL' ? 'var(--accent-rose)' : 'var(--accent-amber)'};">${worst}</strong></td>
            <td><code style="font-size:0.72rem;color:var(--text-muted);">${this._esc(log.payloadHash ?? '—')}</code></td>
            <td><span style="font-size:0.75rem;">${log.payloadLength ?? '—'} car.</span></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">${
        err.code === 401 ? 'Introduce tu clave de API para ver la auditoría.' : this._esc(err.message)
      }</td></tr>`;
    }
  }

  static _renderChainStatus(ledger) {
    if (!ledger) return;

    let el = document.getElementById('audit-chain-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'audit-chain-status';
      el.style.cssText = 'padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:0.75rem;line-height:1.5;';
      document.getElementById('security-logs-tbody')?.closest('.card, section, div')?.prepend(el);
    }

    const ok = ledger.integrity.isValid;
    el.style.background = ok ? 'rgba(16,185,129,0.10)' : 'rgba(244,63,94,0.12)';
    el.style.border = `1px solid ${ok ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.45)'}`;
    el.style.color = ok ? '#6ee7b7' : '#fda4af';

    el.innerHTML = ok
      ? `✓ Cadena de auditoría íntegra · ${ledger.blocks} bloques en memoria de ${ledger.totalAppended} registrados`
        + `<div style="color:var(--text-muted);margin-top:4px;">${this._esc(ledger.integrity.scope)}</div>`
      : `✖ Integridad comprometida: ${this._esc(ledger.integrity.reason)}`;
  }

  static _esc(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
}

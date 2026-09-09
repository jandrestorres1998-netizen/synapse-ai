import { ApiService } from '../services/api.service.js';

/**
 * Operations overview.
 *
 * Every figure shown here is labelled with what it actually is. The previous
 * version led with "$ ahorrado", a number derived from a hypothetical baseline
 * in which every request would have gone to a flagship model — money that was
 * never going to be spent. That headline is now "gasto real", with the
 * comparison shown beside it and named as a comparison.
 */
export class OverviewComponent {
  static async render() {
    try {
      const [stats, health] = await Promise.all([ApiService.getStats(), ApiService.getHealth()]);

      this._renderBanner(health, stats);

      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
      };

      set('kpi-money-saved', `$${stats.spend.actualUsd.toFixed(4)}`);
      set('kpi-threats', stats.dlp.totalDetections + stats.counters.injectionsBlocked);
      set('kpi-cache-rate', `${stats.cacheHitRatePercent}%`);
      set('kpi-latency', stats.latency.p50Ms === null ? '—' : `${Math.round(stats.latency.p50Ms)} ms`);

      this._relabel('kpi-money-saved', 'Gasto real en proveedores', `Comparado con enviar todo al modelo de referencia: $${stats.spend.baselineComparisonUsd.toFixed(4)}`);
      this._relabel('kpi-latency', 'Latencia p50', `p95: ${stats.latency.p95Ms === null ? '—' : Math.round(stats.latency.p95Ms) + ' ms'} · ${stats.latency.samples} muestras`);

      this._renderActivity(stats.history);
    } catch (err) {
      this._renderError(err);
    }
  }

  /** Updates a KPI card's caption so the number is never read out of context. */
  static _relabel(kpiId, label, subtitle) {
    const card = document.getElementById(kpiId)?.closest('.metric-card, .kpi-card, .card');
    if (!card) return;

    const labelEl = card.querySelector('.metric-label, .kpi-label');
    if (labelEl) labelEl.innerText = label;

    let note = card.querySelector('.kpi-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'kpi-note';
      note.style.cssText = 'font-size:0.7rem;color:var(--text-muted);margin-top:4px;line-height:1.3;';
      card.appendChild(note);
    }
    note.innerText = subtitle;
  }

  /** A visible banner when no real provider is reachable. */
  static _renderBanner(health, stats) {
    let banner = document.getElementById('synapse-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'synapse-status-banner';
      banner.style.cssText = 'padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:0.8rem;font-weight:600;';
      document.querySelector('#pane-overview')?.prepend(banner);
    }

    if (!stats.hasRealProvider) {
      banner.style.cssText += 'display:block;background:rgba(244,63,94,0.12);border:1px solid rgba(244,63,94,0.4);color:#fda4af;';
      banner.innerText = '⚠ Ningún proveedor de modelos configurado. Las peticiones de inferencia fallarán hasta que añadas una credencial en la pestaña de integración.';
    } else if (health.status !== 'ok') {
      banner.style.cssText += 'display:block;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;';
      banner.innerText = '⚠ Servicio degradado. Revisa /healthz para el detalle.';
    } else {
      banner.style.display = 'none';
    }
  }

  static _renderActivity(history) {
    const container = document.getElementById('recent-activity-list');
    if (!container) return;

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--text-muted);">Sin actividad todavía. Prueba una consulta en el Playground.</div>';
      return;
    }

    const badge = {
      cache: ['badge-cached', '⚡ CACHÉ'],
      upstream: ['badge-routed', '🔄 PROVEEDOR'],
      blocked: ['badge-masked', '⛔ BLOQUEADA'],
      error: ['badge-masked', '✖ ERROR']
    };

    container.innerHTML = history.slice(0, 8).map(item => {
      const [cls, label] = badge[item.outcome] ?? ['badge-routed', item.outcome];
      const cost = item.costUsd > 0
        ? `$${item.costUsd.toFixed(5)}${item.costIsEstimate ? ' (est.)' : ''}`
        : '$0';
      const tokens = item.inputTokens !== null ? `${item.inputTokens}+${item.outputTokens} tok` : '—';

      return `
        <div class="stream-item">
          <div class="stream-left">
            <span class="stream-badge ${cls}">${label}</span>
            ${item.dlpMasked ? '<span class="stream-badge badge-masked">🛡️ DLP</span>' : ''}
            <span><strong>${item.model ?? '—'}</strong></span>
          </div>
          <div class="stream-right text-muted">
            <span>${tokens} · ${cost} · ${item.latencyMs ?? '—'} ms</span>
          </div>
        </div>
      `;
    }).join('');
  }

  static _renderError(err) {
    const container = document.getElementById('recent-activity-list');
    if (!container) return;

    container.innerHTML = err.code === 401
      ? '<div class="text-danger" style="padding:16px;">Introduce tu clave de API en la cabecera para ver la telemetría.</div>'
      : `<div class="text-danger" style="padding:16px;">No se pudo cargar la telemetría: ${err.message}</div>`;
  }
}

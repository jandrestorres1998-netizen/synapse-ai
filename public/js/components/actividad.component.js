import { ApiService } from '../services/api.service.js';
import { esc, $, setText, setHTML, money, integer, time, notice } from '../ui.js';

/**
 * Actividad: qué está pasando y cuánto cuesta.
 *
 * Cada cifra dice de dónde sale. No hay «ahorro»: se muestra el gasto real, y
 * la comparación contra un modelo de referencia — cuando aparece — se llama
 * comparación, porque asume que todas las peticiones habrían ido a ese modelo.
 */
export class ActividadComponent {
  static init() {
    $('btn-refresh')?.addEventListener('click', () => this.render());
    document.addEventListener('synapse:activity', () => this.render());
  }

  static async render() {
    try {
      const stats = await ApiService.getStats();
      this.renderBanner(stats);
      this.renderMetrics(stats);
      this.renderRows(stats.history ?? []);
      document.dispatchEvent(new CustomEvent('synapse:stats', { detail: stats }));
    } catch (err) {
      setHTML('activity-banner', err.code === 401
        ? notice({ tone: 'warning', iconName: 'alert', title: 'Falta la clave de API', text: 'Introdúcela en la cabecera para ver la telemetría.' })
        : notice({ tone: 'critical', iconName: 'alert', title: 'No se pudo cargar la telemetría', text: esc(err.message) }));
    }
  }

  static renderBanner(stats) {
    if (!stats.hasRealProvider) {
      setHTML('activity-banner', notice({
        tone: 'critical',
        iconName: 'alert',
        title: 'Ningún proveedor de modelos configurado',
        text: 'Las peticiones de inferencia fallarán con 503 hasta que añadas una credencial en Ajustes. El gateway no devuelve texto sintético en su lugar.'
      }));
      return;
    }

    const estimated = stats.spend?.estimatedPortionUsd ?? 0;
    if (estimated > 0) {
      setHTML('activity-banner', notice({
        tone: 'warning',
        iconName: 'info',
        title: 'Parte del gasto es una estimación',
        text: `${money(estimated)} proceden de llamadas cuyo proveedor no reportó el uso de tokens.`
      }));
      return;
    }

    setHTML('activity-banner', '');
  }

  static renderMetrics(stats) {
    const counters = stats.counters ?? {};
    const spend = stats.spend ?? {};
    const budget = stats.budget?.tenant?.daily;

    setText('m-spend', money(spend.actualUsd));

    const bar = $('m-spend-bar');
    if (budget?.enforced && budget.limitUsd > 0) {
      const pct = Math.min(100, ((budget.spentUsd + budget.reservedUsd) / budget.limitUsd) * 100);
      bar.querySelector('span').style.width = `${pct}%`;
      bar.className = `bar${pct >= 90 ? ' critical' : pct >= 70 ? ' warning' : ''}`;
      setText('m-spend-note', `${Math.round(pct)} % del tope diario de ${money(budget.limitUsd, { compact: true })}`);
    } else {
      bar.querySelector('span').style.width = '0%';
      setText('m-spend-note', 'Sin tope configurado: se contabiliza, no se detiene.');
    }

    setText('m-requests', integer(counters.requestsTotal));
    setText('m-requests-note',
      `${integer(counters.requestsSentUpstream)} al proveedor · ${integer(counters.requestsServedByCache)} desde caché`
      + (counters.requestsBlocked ? ` · ${integer(counters.requestsBlocked)} bloqueadas` : ''));

    const latency = stats.latency ?? {};
    setText('m-latency', latency.p50Ms === null || latency.p50Ms === undefined ? '—' : `${Math.round(latency.p50Ms)}`);
    const unit = $('m-latency');
    if (unit && latency.p50Ms !== null && latency.p50Ms !== undefined) {
      unit.innerHTML = `${Math.round(latency.p50Ms)} <span class="unit">ms</span>`;
    }
    setText('m-latency-note', latency.samples
      ? `p95 en ${Math.round(latency.p95Ms)} ms · ${integer(latency.samples)} muestras`
      : 'Sin muestras todavía.');

    const cacheEl = $('m-cache');
    if (cacheEl) cacheEl.innerHTML = `${stats.cacheHitRatePercent ?? 0} <span class="unit">%</span>`;
  }

  static renderRows(history) {
    const container = $('activity-rows');
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = '<div class="table-empty">Sin actividad todavía. Prueba una consulta en la pestaña Probar.</div>';
      return;
    }

    const tag = {
      cache: '<span class="tag">caché</span>',
      blocked: '<span class="tag critical">bloqueada</span>',
      error: '<span class="tag critical">error</span>',
      cancelled: '<span class="tag">cancelada</span>',
      upstream: ''
    };

    container.innerHTML = history.slice(0, 30).map(item => `
      <div class="table-row" style="grid-template-columns: 84px 1fr 140px 120px 100px 88px;">
        <span class="num" style="color: var(--ink-muted);">${time(item.timestamp)}</span>
        <span style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(item.provider ?? '—')}</span>
          ${tag[item.outcome] ?? ''}
          ${item.dlpMasked ? '<span class="tag warning">enmascarado</span>' : ''}
        </span>
        <span style="color: var(--ink-muted);">${esc(item.model ?? '—')}</span>
        <span class="num" style="color: var(--ink-muted);">${item.inputTokens === null ? '—' : `${integer(item.inputTokens)} · ${integer(item.outputTokens)}`}</span>
        <span class="num">${money(item.costUsd)}${item.costIsEstimate && item.costUsd > 0 ? '<span style="color: var(--ink-faint);"> est.</span>' : ''}</span>
        <span class="num" style="color: var(--ink-muted);">${item.latencyMs === null ? '—' : `${item.latencyMs} ms`}</span>
      </div>`).join('');
  }
}

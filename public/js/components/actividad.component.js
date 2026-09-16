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
  static currentFilter = 'todo';
  static rawHistory = [];

  static init() {
    $('btn-refresh')?.addEventListener('click', () => this.render());
    document.addEventListener('synapse:activity', () => this.render());

    document.querySelectorAll('.filter-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter || 'todo';
        this.renderRows(this.rawHistory);
      });
    });
  }

  static async render() {
    try {
      const stats = await ApiService.getStats();
      this.renderBanner(stats);
      this.renderMetrics(stats);
      this.rawHistory = stats.history ?? [];
      this.renderRows(this.rawHistory);
      document.dispatchEvent(new CustomEvent('synapse:stats', { detail: stats }));
    } catch (err) {
      setHTML('activity-banner', err.code === 401
        ? notice({ tone: 'warning', iconName: 'alert', title: 'Llave de API requerida', text: 'Ingrese su llave en la barra lateral para consultar la telemetría.' })
        : notice({ tone: 'critical', iconName: 'alert', title: 'No se pudo cargar la telemetría', text: esc(err.message) }));
    }
  }

  static renderBanner(stats) {
    if (!stats.hasRealProvider) {
      setHTML('activity-banner', notice({
        tone: 'critical',
        iconName: 'alert',
        title: 'Sin proveedores LLM configurados',
        text: 'Las peticiones de inferencia responderán con 503 hasta que configure una llave en Proveedores y Bóveda. El gateway no genera texto sintético simulado.'
      }));
      return;
    }

    const estimated = stats.spend?.estimatedPortionUsd ?? 0;
    if (estimated > 0) {
      setHTML('activity-banner', notice({
        tone: 'warning',
        iconName: 'info',
        title: 'Consumo parcialmente estimado',
        text: `${money(estimated)} proceden de llamadas cuyo proveedor no reportó el uso de tokens en tiempo real.`
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
      setText('m-spend-note', `${Math.round(pct)} % del límite diario de ${money(budget.limitUsd, { compact: true })}`);
    } else {
      bar.querySelector('span').style.width = '0%';
      setText('m-spend-note', 'Sin límite asignado: se registra el consumo sin bloqueo por cuota.');
    }

    setText('m-requests', integer(counters.requestsTotal));
    setText('m-requests-note',
      `${integer(counters.requestsSentUpstream)} al proveedor · ${integer(counters.requestsServedByCache)} desde caché`
      + (counters.requestsBlocked ? ` · ${integer(counters.requestsBlocked)} bloqueadas` : ''));

    const latency = stats.latency ?? {};
    setText('m-latency', latency.p50Ms === null || latency.p50Ms === undefined ? '—' : `${Math.round(latency.p50Ms)}`);
    const unit = $('m-latency');
    if (unit && latency.p50Ms !== null && latency.p50Ms !== undefined) {
      unit.textContent = `${Math.round(latency.p50Ms)} `;
      const span = document.createElement('span');
      span.className = 'unit';
      span.textContent = 'ms';
      unit.appendChild(span);
    }
    setText('m-latency-note', latency.samples
      ? `p95 en ${Math.round(latency.p95Ms)} ms · ${integer(latency.samples)} muestras`
      : 'Sin muestras todavía.');

    const cacheEl = $('m-cache');
    if (cacheEl) {
      cacheEl.textContent = `${stats.cacheHitRatePercent ?? 0} `;
      const span = document.createElement('span');
      span.className = 'unit';
      span.textContent = '%';
      cacheEl.appendChild(span);
    }
  }

  static renderRows(history) {
    const container = $('activity-rows');
    if (!container) return;

    let filtered = history || [];
    if (this.currentFilter === 'dlp') {
      filtered = filtered.filter(item => item.dlpMasked);
    } else if (this.currentFilter === 'bloq') {
      filtered = filtered.filter(item => item.outcome === 'blocked');
    } else if (this.currentFilter === 'cache') {
      filtered = filtered.filter(item => item.outcome === 'cache');
    }

    container.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'table-empty';
      empty.textContent = 'No hay peticiones para este filtro.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    filtered.slice(0, 30).forEach(item => {
      const row = document.createElement('div');
      row.className = 'table-row';
      row.style.gridTemplateColumns = '84px 1fr 140px 120px 100px 88px';

      const timeCol = document.createElement('span');
      timeCol.className = 'num';
      timeCol.style.color = 'var(--ink-muted)';
      timeCol.textContent = time(item.timestamp);
      row.appendChild(timeCol);

      const provCol = document.createElement('span');
      provCol.style.display = 'flex';
      provCol.style.alignItems = 'center';
      provCol.style.gap = '8px';
      provCol.style.minWidth = '0';

      const provName = document.createElement('span');
      provName.style.overflow = 'hidden';
      provName.style.textOverflow = 'ellipsis';
      provName.style.whiteSpace = 'nowrap';
      provName.textContent = item.provider ?? '—';
      provCol.appendChild(provName);

      if (item.outcome === 'cache') {
        const tagCache = document.createElement('span');
        tagCache.className = 'tag';
        tagCache.textContent = 'caché';
        provCol.appendChild(tagCache);
      } else if (item.outcome === 'blocked') {
        const tagBloq = document.createElement('span');
        tagBloq.className = 'tag critical';
        tagBloq.textContent = 'bloqueada';
        provCol.appendChild(tagBloq);
      } else if (item.outcome === 'error') {
        const tagErr = document.createElement('span');
        tagErr.className = 'tag critical';
        tagErr.textContent = 'error';
        provCol.appendChild(tagErr);
      }

      if (item.dlpMasked) {
        const tagDlp = document.createElement('span');
        tagDlp.className = 'tag warning';
        tagDlp.textContent = 'enmascarado';
        provCol.appendChild(tagDlp);
      }
      row.appendChild(provCol);

      const modelCol = document.createElement('span');
      modelCol.style.color = 'var(--ink-muted)';
      modelCol.textContent = item.model ?? '—';
      row.appendChild(modelCol);

      const tokensCol = document.createElement('span');
      tokensCol.className = 'num';
      tokensCol.style.color = 'var(--ink-muted)';
      tokensCol.textContent = item.inputTokens === null ? '—' : `${integer(item.inputTokens)} · ${integer(item.outputTokens)}`;
      row.appendChild(tokensCol);

      const costCol = document.createElement('span');
      costCol.className = 'num';
      costCol.textContent = money(item.costUsd);
      if (item.costIsEstimate && item.costUsd > 0) {
        const estSpan = document.createElement('span');
        estSpan.style.color = 'var(--ink-faint)';
        estSpan.textContent = ' est.';
        costCol.appendChild(estSpan);
      }
      row.appendChild(costCol);

      const latCol = document.createElement('span');
      latCol.className = 'num';
      latCol.style.color = 'var(--ink-muted)';
      latCol.textContent = item.latencyMs === null ? '—' : `${item.latencyMs} ms`;
      row.appendChild(latCol);

      fragment.appendChild(row);
    });

    container.appendChild(fragment);
  }
}

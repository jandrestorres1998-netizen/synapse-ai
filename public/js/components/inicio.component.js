import { ApiService } from '../services/api.service.js';
import { esc, money, integer } from '../ui.js';

/**
 * Inicio: qué está pasando y qué pide una decisión.
 *
 * Todas las cifras salen de /api/stats, /api/budget y del registro. Ninguna
 * tiene valor de reserva: si el contador está a cero, se enseña un cero. La
 * versión anterior caía a cifras de ejemplo cuando el valor real era cero o el
 * campo no existía —y como los nombres de campo no coincidían con la API, caía
 * siempre—, así que el panel enseñaba 1.284 peticiones en una instalación
 * recién arrancada.
 */
export class InicioComponent {
  constructor(container) {
    this.container = container;
  }

  async render() {
    try {
      const [stats, seguridad] = await Promise.all([
        ApiService.getStats(),
        ApiService.getSecurityLogs().catch(() => null)
      ]);
      this.container.innerHTML = this.marco(stats, seguridad);
      this.wire();
    } catch (err) {
      this.container.innerHTML = err.code === 401
        ? '<div class="card"><span class="metric-note">Ingrese su llave de API en la barra lateral para ver el estado de la instancia.</span></div>'
        : `<div class="card"><span class="metric-note">${esc(err.message)}</span></div>`;
    }
  }

  /**
   * Reparte el historial en doce tramos por hora. Es el dato que hay: la
   * telemetría guarda las últimas peticiones con su marca de tiempo, no una
   * serie agregada. Con pocas peticiones el gráfico sale pobre, y eso es lo
   * que corresponde enseñar.
   */
  static porHora(history = []) {
    const ahora = new Date();
    const tramos = [];

    for (let i = 11; i >= 0; i--) {
      const inicio = new Date(ahora.getTime() - i * 3600000);
      tramos.push({ hora: `${String(inicio.getHours()).padStart(2, '0')}h`, limpio: 0, redactado: 0 });
    }

    for (const item of history) {
      const t = new Date(item.timestamp).getTime();
      const desfase = Math.floor((ahora.getTime() - t) / 3600000);
      if (desfase < 0 || desfase > 11) continue;
      const tramo = tramos[11 - desfase];
      if (item.dlpMasked) tramo.redactado++;
      else tramo.limpio++;
    }

    const techo = Math.max(1, ...tramos.map(t => t.limpio + t.redactado));
    return tramos.map(t => ({
      ...t,
      altoLimpio: `${Math.round((t.limpio / techo) * 100)}%`,
      altoRedactado: `${Math.round((t.redactado / techo) * 100)}%`
    }));
  }

  /** Barritas de un KPI: la misma serie por hora, en pequeño. */
  static chispa(valores, color) {
    const techo = Math.max(1, ...valores);
    return valores.map(v => `<span style="height:${Math.round((v / techo) * 100)}%;background:${color}"></span>`).join('');
  }

  kpi(etiqueta, valor, chispa, procedencia) {
    return `
      <div class="card">
        <span class="metric-title">${esc(etiqueta)}</span>
        <span class="metric-value">${valor}</span>
        <div class="kpi-sparkline">${chispa}</div>
        <span class="metric-note">${esc(procedencia)}</span>
      </div>`;
  }

  marco(stats, seguridad) {
    const contadores = stats.counters ?? {};
    const gasto = stats.spend ?? {};
    const horas = InicioComponent.porHora(stats.history ?? []);

    const serieTotal = horas.map(h => h.limpio + h.redactado);
    const serieRedac = horas.map(h => h.redactado);

    const hayTrafico = serieTotal.some(v => v > 0);

    const kpis = [
      this.kpi('Peticiones Procesadas', integer(contadores.requestsTotal),
        InicioComponent.chispa(serieTotal, 'var(--probar)'),
        'Medido · contador del gateway'),
      this.kpi('Datos Anonimizados (DLP)', integer(stats.dlp?.totalDetections),
        InicioComponent.chispa(serieRedac, 'var(--warning)'),
        'Medido · detecciones prevenidas por DLP'),
      this.kpi('Ahorro por Caché Semántica', `${stats.cacheHitRatePercent ?? 0} <span class="unit">%</span>`,
        InicioComponent.chispa(horas.map(h => h.limpio), 'var(--ok)'),
        'Medido · sobre su tráfico real'),
      this.kpi('Consumo Total (USD)', money(gasto.actualUsd, { compact: true }),
        InicioComponent.chispa(serieTotal, 'var(--spend)'),
        gasto.estimatedPortionUsd > 0
          ? 'Parte estimada · proveedores sin reporte en tiempo real'
          : 'Medido · telemetría reportada por proveedores')
    ].join('');

    return `
      <div class="stack">
        ${this.guiaPrimeraEjecucion(stats)}

        <div class="grid kpis">${kpis}</div>

        <div class="grid cols">
          <div class="card flush">
            <div class="card-head">
              <span class="eyebrow">Estado de la Instancia</span>
              ${this.contadorAvisos(stats, seguridad)}
            </div>
            ${this.estado(stats, seguridad)}
          </div>

          <div class="stack">
            <div class="card flush">
              <div class="card-head"><span class="eyebrow">Peticiones por hora · últimas 12 h</span></div>
              <div class="card-body">
                <div class="traffic-chart-container">
                  ${horas.map(h => `
                    <div class="traffic-col">
                      <span class="bar-redacted" style="height:${h.altoRedactado}"></span>
                      <span class="bar-clean" style="height:${h.altoLimpio}"></span>
                      <span class="bar-label">${esc(h.hora)}</span>
                    </div>`).join('')}
                </div>
                <div class="legend">
                  <span><span class="key" style="background:var(--probar)"></span> Tráfico regular</span>
                  <span><span class="key" style="background:var(--warning)"></span> Con datos enmascarados</span>
                  <span class="push">${hayTrafico ? 'Medido · contador del gateway' : 'Sin tráfico en las últimas 12 h'}</span>
                </div>
              </div>
            </div>

            <div class="grid tight">
              <button class="shortcut-btn" data-target-tab="probar">
                <span class="shortcut-title">Probar Gateway</span>
                <span class="shortcut-desc">Inspeccionar en vivo el payload sanitizado.</span>
              </button>
              <button class="shortcut-btn" data-target-tab="proteccion">
                <span class="shortcut-title">Reglas DLP</span>
                <span class="shortcut-desc">Filtros activos y patrones de validación.</span>
              </button>
              <button class="shortcut-btn" data-target-tab="ajustes">
                <span class="shortcut-title">Proveedores y Bóveda</span>
                <span class="shortcut-desc">Conectores LLM, llaves y topes USD.</span>
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /** Cada fila es una comprobación real; si no hay dato, la fila no aparece. */
  comprobaciones(stats, seguridad) {
    const filas = [];
    const providers = stats.providers ?? {};
    const reales = Object.entries(providers).filter(([n, p]) => p.configured && n !== 'mock');
    const integridad = seguridad?.ledger?.integrity;

    if (integridad) {
      filas.push(integridad.isValid
        ? { ok: true, titulo: 'Registro Criptográfico Válido', detalle: `${integer(seguridad.ledger.totalAppended)} eventos encadenados por SHA-256.`, valor: 'Íntegro' }
        : { ok: false, titulo: 'Discrepancia en Registro Criptográfico', detalle: integridad.reason ?? 'Alguna entrada no coincide con su hash.', valor: 'Revisar' });
    }

    filas.push(reales.length > 0
      ? { ok: true, titulo: 'Proveedores LLM Conectados', detalle: `Activos: ${reales.map(([n]) => n).join(', ')}.`, valor: `${reales.length} / ${Object.keys(providers).length - (providers.mock ? 1 : 0)}` }
      : { ok: false, titulo: 'Sin Proveedores Configurados', detalle: 'Configure al menos una llave de proveedor en la bóveda.', valor: 'Pendiente' });

    if (providers.mock?.configured) {
      filas.push({ ok: false, titulo: 'Modo Simulación (Mock) Activo', detalle: 'Devuelve respuestas sintéticas para pruebas locales.', valor: 'Simulación' });
    }

    if (stats.dlp?.plaintextRetention) {
      filas.push({ ok: false, titulo: 'Retención de Texto Plano Activa', detalle: 'El registro almacena el texto sin cifrar. Desactive en producción.', valor: 'Aviso' });
    }

    const tope = stats.budget?.tenant?.daily;
    if (tope?.enforced) {
      const usado = (tope.spentUsd + tope.reservedUsd) / tope.limitUsd;
      filas.push(usado >= 0.8
        ? { ok: false, titulo: 'Alerta de Presupuesto USD (≥80%)', detalle: `${Math.round(usado * 100)} % del límite diario consumido o reservado.`, valor: 'Alerta' }
        : { ok: true, titulo: 'Consumo dentro de Presupuesto', detalle: `${Math.round(usado * 100)} % del límite diario en uso.`, valor: 'Normal' });
    } else {
      filas.push({ ok: false, titulo: 'Sin Límite de Presupuesto Asignado', detalle: 'El consumo se registra pero no cuenta con tope de detención.', valor: 'Informativo' });
    }

    return filas;
  }

  contadorAvisos(stats, seguridad) {
    const avisos = this.comprobaciones(stats, seguridad).filter(f => !f.ok).length;
    if (avisos === 0) return '<span class="tag ok pill" style="margin-left:auto">Operativo</span>';
    return `<span class="tag warning pill" style="margin-left:auto">${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}</span>`;
  }

  estado(stats, seguridad) {
    return this.comprobaciones(stats, seguridad).map(f => `
      <div class="state-row">
        <span style="color:${f.ok ? 'var(--ok-ink)' : 'oklch(0.60 0.17 62)'}">
          ${f.ok
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'}
        </span>
        <div>
          <p class="t">${esc(f.titulo)}</p>
          <p class="d">${esc(f.detalle)}</p>
        </div>
        <span class="v" style="color:${f.ok ? 'var(--ok-ink)' : 'oklch(0.60 0.17 62)'}">${esc(f.valor)}</span>
      </div>`).join('');
  }

  guiaPrimeraEjecucion(stats) {
    const key = localStorage.getItem('synapse_api_key') || sessionStorage.getItem('synapse_api_key');
    const claveValida = Boolean(key && key.trim().length > 0);

    const providers = stats.providers ?? {};
    const tieneProveedor = Object.entries(providers).some(([n, p]) => p.configured && n !== 'mock');

    const tienePeticiones = (stats.counters?.requestsTotal ?? 0) > 0;

    const progreso = [claveValida, tieneProveedor, tienePeticiones].filter(Boolean).length;

    return `
      <div class="onboarding-card" id="onboarding-card">
        <div class="onboarding-head">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="eyebrow" style="margin:0;color:var(--probar)">Puesta en Marcha</span>
            <span class="badge-step-count">${progreso} de 3 completados</span>
          </div>
          <h2 style="font-size:20px;margin:8px 0 4px;font-family:var(--font-display);color:var(--ink-strong)">
            ${progreso === 3 ? 'Instalación Verificada y Operativa' : 'Puesta en marcha de su instancia en 3 pasos'}
          </h2>
          <p style="font-size:14px;color:var(--ink-muted);margin:0">
            ${progreso === 3
              ? 'Su pasarela está plenamente operativa: llave validada, proveedores activos y peticiones registradas.'
              : 'Siga estos tres pasos para activar su pasarela de seguridad con sus aplicaciones y modelos de IA.'}
          </p>
        </div>

        <div class="onboarding-steps-grid">
          <!-- Paso 1 -->
          <div class="onboarding-step-item ${claveValida ? 'is-complete' : 'is-active'}">
            <div class="step-num">${claveValida ? '✓' : '1'}</div>
            <div class="step-content">
              <h4>1. Llave de acceso</h4>
              <p>Autentique su sesión para gobernar el gateway y administrar llaves de aplicación.</p>
              <div class="step-action">
                ${claveValida
                  ? '<span class="step-status-tag ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Llave autenticada</span>'
                  : '<button class="btn btn-sm btn-onboarding-action" data-action="focus-key">Validar llave</button>'}
              </div>
            </div>
          </div>

          <!-- Paso 2 -->
          <div class="onboarding-step-item ${tieneProveedor ? 'is-complete' : (claveValida ? 'is-active' : '')}">
            <div class="step-num">${tieneProveedor ? '✓' : '2'}</div>
            <div class="step-content">
              <h4>2. Conectar proveedor</h4>
              <p>Guarde con cifrado AES-256 las llaves de OpenAI, Anthropic, Google o su instancia local Ollama.</p>
              <div class="step-action">
                ${tieneProveedor
                  ? '<span class="step-status-tag ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Proveedores listos</span>'
                  : '<button class="btn btn-sm btn-onboarding-action" data-action="goto-providers">Configurar Proveedores</button>'}
              </div>
            </div>
          </div>

          <!-- Paso 3 -->
          <div class="onboarding-step-item ${tienePeticiones ? 'is-complete' : (claveValida && tieneProveedor ? 'is-active' : '')}">
            <div class="step-num">${tienePeticiones ? '✓' : '3'}</div>
            <div class="step-content">
              <h4>3. Primera petición</h4>
              <p>Envíe una consulta de prueba para verificar en vivo la anonimización DLP y el enrutamiento inteligente.</p>
              <div class="step-action">
                ${tienePeticiones
                  ? '<span class="step-status-tag ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Petición auditada</span>'
                  : '<button class="btn btn-sm btn-onboarding-action" data-action="goto-probar">Probar Gateway</button>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  wire() {
    this.container.querySelectorAll('.shortcut-btn').forEach(boton => {
      boton.addEventListener('click', () => {
        const destino = boton.dataset.targetTab;
        if (destino && window.switchDashboardTab) window.switchDashboardTab(destino);
      });
    });

    this.container.querySelectorAll('.btn-onboarding-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'focus-key') {
          const keyInput = document.getElementById('api-key');
          if (keyInput) {
            keyInput.focus();
            keyInput.classList.add('pulse-pop');
            setTimeout(() => keyInput.classList.remove('pulse-pop'), 800);
          }
        } else if (action === 'goto-providers') {
          if (window.switchDashboardTab) window.switchDashboardTab('ajustes');
        } else if (action === 'goto-probar') {
          if (window.switchDashboardTab) window.switchDashboardTab('probar');
        }
      });
    });
  }
}

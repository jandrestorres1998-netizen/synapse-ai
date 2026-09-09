import { ApiService } from '../services/api.service.js';
import { OverviewComponent } from './overview.component.js';

const SAMPLES = {
  pii: 'Transferir a la cuenta IBAN GB82WEST12345698765432 del cliente con DNI 12345678Z. Clave de producción: sk-proj-123456789012345678901234. Tarjeta 4539578763621486.',
  complex: 'Refactoriza este servicio para eliminar una race condition en el acceso concurrente al pool de conexiones, manteniendo compatibilidad con la API pública.',
  cached: 'Resume las mejores prácticas de seguridad para tokens JWT en 3 puntos claros.'
};

export class PlaygroundComponent {
  static init() {
    window.loadSamplePrompt = this.loadSamplePrompt.bind(this);
    window.runGatewaySim = this.run.bind(this);
  }

  static loadSamplePrompt(type) {
    const input = document.getElementById('playground-prompt-input');
    if (input && SAMPLES[type]) input.value = SAMPLES[type];
  }

  static async run() {
    const input = document.getElementById('playground-prompt-input');
    const inspector = document.getElementById('inspector-content');
    const badge = document.getElementById('inspector-badge');
    const button = document.getElementById('btn-run-gateway');
    const prompt = input?.value.trim();

    if (!prompt) {
      alert('Escribe un prompt de prueba.');
      return;
    }

    button.disabled = true;
    button.innerText = 'Procesando…';
    badge.innerText = 'EN CURSO';
    badge.style.color = 'var(--accent-cyan)';

    try {
      const data = await ApiService.processGateway(prompt, 'dashboard');
      badge.innerText = data.source === 'cache' ? '⚡ SERVIDO DESDE CACHÉ' : '✓ COMPLETADO';
      badge.style.color = 'var(--accent-emerald)';
      inspector.innerHTML = this._renderResult(data);
      OverviewComponent.render();
    } catch (err) {
      badge.innerText = err.payload?.stage === 'prompt_injection' ? '⛔ BLOQUEADO' : 'ERROR';
      badge.style.color = 'var(--accent-rose)';
      inspector.innerHTML = this._renderError(err);
    } finally {
      button.disabled = false;
      button.innerHTML = '<span>⚡ Enviar a través de SynapseAI</span>';
    }
  }

  static _renderResult(data) {
    const ingress = data.dlp?.ingressDetections ?? [];
    const egress = data.dlp?.egressDetections ?? [];

    const dlpNode = ingress.length > 0
      ? `<div class="telemetry-node highlight-red">
           <div class="node-title" style="color:var(--accent-rose);">🛡️ DLP: ${ingress.length} elemento(s) enmascarado(s) antes de salir</div>
           <div class="node-content">
             ${ingress.map(d => `<div>· <strong>${this._esc(d.name)}</strong> (${d.severity}) — ${this._esc(d.snippet)}</div>`).join('')}
             <p style="margin-top:8px;color:var(--text-muted);font-size:0.72rem;">El valor original no se almacena; solo queda un hash para correlación en la auditoría.</p>
           </div>
         </div>`
      : '<div class="telemetry-node highlight-green"><div class="node-title" style="color:var(--accent-emerald);">🛡️ DLP: sin coincidencias en los patrones configurados</div></div>';

    const routingNode = data.source === 'cache'
      ? `<div class="telemetry-node highlight-blue">
           <div class="node-title" style="color:var(--accent-cyan);">⚡ Caché (${data.matchType})</div>
           <div class="node-content">
             <p>Respuesta almacenada el ${new Date(data.cachedAt).toLocaleString()}. No se consumieron tokens del proveedor.</p>
             ${data.matchType === 'semantic' ? '<p style="color:var(--accent-amber);margin-top:6px;">Coincidencia por similitud: la respuesta se generó para un prompt distinto pero parecido.</p>' : ''}
           </div>
         </div>`
      : `<div class="telemetry-node highlight-blue">
           <div class="node-title" style="color:var(--accent-cyan);">🔄 Enrutado a ${this._esc(data.model.label)} (${this._esc(data.model.provider)})</div>
           <div class="node-content">
             <p><strong>Criterio:</strong> ${this._esc(data.routing?.reasoning ?? '—')}</p>
             ${data.routing?.degradedFrom ? `<p style="color:var(--accent-amber);">Nivel "${data.routing.degradedFrom}" no disponible; se degradó.</p>` : ''}
             ${data.routing?.failedOverFrom ? `<p style="color:var(--accent-amber);">Failover desde ${this._esc(data.routing.failedOverFrom)}.</p>` : ''}
             <p style="margin-top:6px;">
               Tokens: <strong>${data.usage.inputTokens} entrada / ${data.usage.outputTokens} salida</strong>${data.usage.measured ? '' : ' (estimados)'}
               · Coste: <strong>$${data.cost.usd.toFixed(6)}</strong>${data.cost.isEstimate ? ' (estimado)' : ''}
               · Latencia: <strong>${data.latencyMs} ms</strong>
             </p>
             ${data.comparison ? `<p style="color:var(--text-muted);font-size:0.72rem;margin-top:4px;">
               En ${this._esc(data.comparison.baselineModelId)} habría costado $${data.comparison.baselineUsd.toFixed(6)}. Es una comparación, no gasto evitado.
             </p>` : ''}
           </div>
         </div>`;

    const egressNode = egress.length > 0
      ? `<div class="telemetry-node highlight-red">
           <div class="node-title" style="color:var(--accent-rose);">🛡️ DLP de salida: ${egress.length} elemento(s) enmascarado(s) en la respuesta del modelo</div>
         </div>`
      : '';

    const responseNode = `
      <div class="telemetry-node">
        <div class="node-title" style="color:#fff;">💬 Respuesta</div>
        <div class="node-content" style="white-space:pre-wrap;background:rgba(0,0,0,0.4);padding:12px;border-radius:6px;">${this._esc(data.response)}</div>
      </div>`;

    return dlpNode + routingNode + egressNode + responseNode;
  }

  static _renderError(err) {
    if (err.payload?.stage === 'prompt_injection') {
      return `<div class="telemetry-node highlight-red">
                <div class="node-title" style="color:var(--accent-rose);">⛔ Petición bloqueada por el filtro de inyección</div>
                <div class="node-content">
                  ${(err.payload.details?.violations ?? []).map(v => `<div>· ${this._esc(v.name)} (${v.severity})</div>`).join('')}
                  <p style="margin-top:8px;color:var(--text-muted);font-size:0.72rem;">No se envió nada al proveedor.</p>
                </div>
              </div>`;
    }

    if (err.code === 401) {
      return '<div class="text-danger">Falta la clave de API. Introdúcela en la cabecera del panel.</div>';
    }

    return `<div class="text-danger">Error del gateway: ${this._esc(err.message)}</div>`;
  }

  static _esc(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
}

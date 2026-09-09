import { ApiService } from './services/api.service.js';
import { esc, $, integer } from './ui.js';

/**
 * Sitio público.
 *
 * El héroe no es una ilustración: es el mismo trazado que pinta el panel. Si la
 * instancia acepta la petición, se ejecuta de verdad; si no, se muestra un
 * recorrido de ejemplo y se dice que lo es, en la propia cabecera del bloque.
 * Un demostrador que finge ejecutar es exactamente lo que este producto
 * reprocha a su competencia.
 */

const EJEMPLO = {
  salida: 'Redacta un correo al cliente Martín Salas, DNI [REDACTED_ES_DNI_NIE], sobre el cargo pendiente en su cuenta [REDACTED_IBAN] y la tarjeta [REDACTED_CARD_NUMBER].',
  etapas: [
    { n: '01', titulo: 'Inyección de prompt', badge: 'Limpio', tono: 'ok', detalle: 'Sin patrones de anulación de instrucciones en los turnos del usuario.' },
    {
      n: '02', titulo: 'Redacción DLP', badge: '3 hallazgos', tono: 'warning',
      detalle: 'Tres identificadores con dígito de control válido, sustituidos antes de la salida.',
      hallazgos: [
        { sigla: 'ES_DNI_NIE', alg: 'MOD-23', valor: '1234····Z' },
        { sigla: 'IBAN', alg: 'MOD-97', valor: 'ES91 2100 ···· 1332' },
        { sigla: 'CARD', alg: 'Luhn', valor: '4111 ···· ···· 1111' }
      ]
    },
    { n: '03', titulo: 'Contexto', badge: 'Mensaje de sistema', detalle: 'Las directrices activas viajan en cada petición y cuentan como tokens de entrada.' },
    { n: '04', titulo: 'Caché', badge: 'Sin coincidencia', detalle: 'Aislada por inquilino, modelo y contexto. Esta combinación no estaba guardada.' },
    { n: '05', titulo: 'Enrutado', badge: 'Al nivel más barato', tono: 'probar', detalle: 'Entre los proveedores realmente configurados, con la razón del enrutado a la vista.' }
  ]
};

const CODIGO = {
  python: {
    texto: 'from openai import OpenAI\n\nclient = OpenAI(\n    base_url="https://gateway.tu-dominio.es/v1",\n    api_key=os.environ["SYNAPSE_KEY"],\n)',
    resaltar: '    base_url="https://gateway.tu-dominio.es/v1",'
  },
  node: {
    texto: 'import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "https://gateway.tu-dominio.es/v1",\n  apiKey: process.env.SYNAPSE_KEY,\n});',
    resaltar: '  baseURL: "https://gateway.tu-dominio.es/v1",'
  },
  curl: {
    texto: 'curl https://gateway.tu-dominio.es/v1/chat/completions \\\n  -H "Authorization: Bearer $SYNAPSE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"auto","messages":[{"role":"user","content":"hola"}]}\'',
    resaltar: 'curl https://gateway.tu-dominio.es/v1/chat/completions \\'
  }
};

class Landing {
  static init() {
    this.renderEtapas(EJEMPLO.etapas, EJEMPLO.salida, 'ejemplo');
    this.detectarInstancia();
    this.wireDemo();
    this.wireCodigo();
  }

  /**
   * Si la instancia responde a /api/stats, las peticiones del demostrador
   * saldrán de verdad. Si no, el bloque queda marcado como ejemplo.
   */
  static async detectarInstancia() {
    try {
      const stats = await ApiService.getStats();
      this.enVivo = true;

      const reales = Object.entries(stats.providers ?? {})
        .filter(([nombre, estado]) => estado.configured && nombre !== 'mock')
        .map(([nombre]) => nombre);

      $('demo-dot').className = 'dot ok';
      $('demo-mode-label').textContent = reales.length
        ? `Esta instancia · ${reales.join(' · ')}`
        : 'Esta instancia · solo proveedor mock';
    } catch {
      this.enVivo = false;
      $('demo-dot').className = 'dot';
      $('demo-mode-label').textContent = 'Recorrido de ejemplo';
    }
  }

  static wireDemo() {
    const boton = $('demo-run');

    boton?.addEventListener('click', async () => {
      if (!this.enVivo) {
        // Sin instancia autenticada no hay nada que ejecutar. Se vuelve a
        // pintar el ejemplo y se dice dónde se ejecuta de verdad.
        this.renderEtapas(EJEMPLO.etapas, EJEMPLO.salida, 'ejemplo', true);
        return;
      }

      boton.disabled = true;
      boton.textContent = 'Ejecutando…';

      try {
        const data = await ApiService.processGateway($('demo-prompt').value.trim(), 'landing');
        this.renderEtapas(this.etapasDe(data), data.response, 'vivo');
      } catch (err) {
        $('demo-out').innerHTML = `
          <div class="egress">
            <div class="egress-head"><span class="eyebrow">La petición no se completó</span></div>
            <p>${esc(err.message)}</p>
          </div>`;
      } finally {
        boton.disabled = false;
        boton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg> Ver qué pasa';
      }
    });
  }

  /** Traduce la respuesta real del gateway a las etapas del trazado. */
  static etapasDe(data) {
    const ingress = data.dlp?.ingressDetections ?? [];

    return [
      { n: '01', titulo: 'Inyección de prompt', badge: 'Limpio', tono: 'ok', detalle: 'Los patrones se evaluaron sobre todos los turnos del usuario.' },
      ingress.length > 0
        ? {
          n: '02',
          titulo: 'Redacción DLP',
          badge: `${ingress.length} ${ingress.length === 1 ? 'hallazgo' : 'hallazgos'}`,
          tono: 'warning',
          detalle: 'Sustituidos antes de la salida. El valor original no se guarda: en la auditoría queda solo un hash.',
          hallazgos: ingress.map(d => ({ sigla: d.name, alg: d.category ?? '', valor: d.snippet ?? '' }))
        }
        : { n: '02', titulo: 'Redacción DLP', badge: 'Sin coincidencias', detalle: 'Ninguno de los patrones configurados reconoció nada en este texto.' },
      {
        n: '03',
        titulo: 'Contexto',
        badge: data.context?.applied ? `${integer(data.context.chars)} caracteres` : 'Sin directrices',
        detalle: data.context?.applied
          ? 'Las directrices activas viajan como mensaje de sistema y cuentan como tokens de entrada.'
          : 'No hay directrices activas en esta instancia.'
      },
      data.source === 'cache'
        ? { n: '04', titulo: 'Caché', badge: data.matchType === 'semantic' ? 'Por similitud' : 'Coincidencia exacta', tono: 'ok', detalle: 'Servida sin consumir tokens del proveedor.' }
        : { n: '04', titulo: 'Caché', badge: 'Sin coincidencia', detalle: 'Aislada por inquilino, modelo y contexto.' },
      {
        n: '05',
        titulo: `Enrutado a ${data.model?.label ?? data.model?.id ?? '—'}`,
        badge: `${integer(data.latencyMs)} ms`,
        tono: 'probar',
        detalle: data.routing?.reasoning ?? 'Entre los proveedores realmente configurados.'
      }
    ];
  }

  static renderEtapas(etapas, salida, modo, avisar = false) {
    const pasos = etapas.map(etapa => `
      <div class="step">
        <div class="step-rail">
          <span class="step-n">${esc(etapa.n)}</span>
          <span class="step-line"></span>
        </div>
        <div class="step-body">
          <div class="step-title-row">
            <span class="step-title">${esc(etapa.titulo)}</span>
            ${etapa.badge ? `<span class="badge ${etapa.tono ?? ''}">${esc(etapa.badge)}</span>` : ''}
          </div>
          <span class="step-note">${esc(etapa.detalle)}</span>
          ${etapa.hallazgos?.length
            ? `<div class="findings">${etapa.hallazgos.map(h => `
                <div class="finding">
                  <span>${esc(h.sigla)}</span>
                  <span class="alg">${esc(h.alg)}</span>
                  <span class="val">${esc(h.valor)}</span>
                </div>`).join('')}</div>`
            : ''}
        </div>
      </div>`).join('');

    const nota = modo === 'ejemplo'
      ? `<p style="margin: 12px 0 0; font-size: 13px; color: var(--ink-faint);">
           Recorrido de ejemplo con datos de muestra${avisar ? '. Para ejecutarlo de verdad, arranca el gateway y abre <a href="/app">el panel</a> con tu clave.' : '.'}
         </p>`
      : '';

    $('demo-out').innerHTML = `
      ${pasos}
      <div class="egress">
        <div class="egress-head"><span class="eyebrow">Texto que sale del perímetro</span></div>
        <p>${esc(salida)}</p>
      </div>
      ${nota}`;
  }

  static wireCodigo() {
    const pintar = lang => {
      const { texto, resaltar } = CODIGO[lang];
      $('code-block').innerHTML = esc(texto).replace(esc(resaltar), `<span class="hl">${esc(resaltar)}</span>`);
      this.langActual = lang;
    };

    document.querySelectorAll('[data-lang]').forEach(boton => {
      boton.addEventListener('click', () => {
        document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('active', b === boton));
        pintar(boton.dataset.lang);
      });
    });

    pintar('python');

    // Se conserva bajo prefers-reduced-motion: es una confirmación funcional,
    // no decoración. Sin ella no se sabe si el copiado ocurrió.
    $('btn-copy')?.addEventListener('click', async event => {
      const boton = event.currentTarget;
      try {
        await navigator.clipboard.writeText(CODIGO[this.langActual].texto);
        boton.textContent = 'Copiado';
        setTimeout(() => { boton.textContent = 'Copiar'; }, 1400);
      } catch {
        boton.textContent = 'No se pudo copiar';
        setTimeout(() => { boton.textContent = 'Copiar'; }, 1400);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => Landing.init());

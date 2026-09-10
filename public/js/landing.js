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
  salida: 'Redacta un correo al cliente Martín Salas, DNI [dato borrado], sobre el cargo pendiente en su cuenta [dato borrado] y la tarjeta [dato borrado].',
  etapas: [
    { n: '01', titulo: 'Se comprueba quién pregunta', badge: 'Correcto', tono: 'ok', detalle: 'Cada programa de la empresa tiene su propia llave. Sin ella no pasa.' },
    {
      n: '02', titulo: 'Se busca si alguien intenta engañar a la IA', badge: 'Limpio', tono: 'ok',
      detalle: 'Los intentos conocidos de darle la vuelta a las instrucciones se paran aquí.'
    },
    {
      n: '03', titulo: 'Se borran los datos de personas', badge: '3 encontrados', tono: 'warning',
      detalle: 'Tres datos con su dígito de control correcto. Se sustituyen antes de salir; el valor original no se guarda en ningún sitio.',
      hallazgos: [
        { sigla: 'Un DNI', alg: 'con letra correcta', valor: '1234····Z' },
        { sigla: 'Una cuenta bancaria', alg: 'IBAN', valor: 'ES91 2100 ···· 1332' },
        { sigla: 'Una tarjeta', alg: 'de crédito o débito', valor: '4111 ···· ···· 1111' }
      ]
    },
    { n: '04', titulo: 'Se añaden vuestras instrucciones', badge: 'Después de borrar', detalle: 'El tono y las normas de la casa viajan con cada consulta. Se añaden después del borrado, no antes.' },
    { n: '05', titulo: 'Se mira si ya se preguntó lo mismo', badge: 'Es nueva', detalle: 'Si la respuesta ya estaba guardada, no se paga otra vez. Esta no estaba.' },
    { n: '06', titulo: 'Se envía y se anota', badge: 'Al más barato que sirve', tono: 'probar', detalle: 'Va al proveedor más económico de los que tengáis contratados, y el envío queda registrado.' }
  ]
};

// El panel usa el nombre técnico de la regla; aquí se vende, así que se dice en
// castellano corriente. Lo que no esté en la tabla cae al nombre original.
const NOMBRE_LLANO = {
  es_dni_nie: 'Un DNI o NIE',
  es_cif: 'El CIF de una empresa',
  iban_bank_account: 'Una cuenta bancaria',
  credit_card: 'Una tarjeta',
  mx_rfc: 'Un RFC mexicano',
  mx_curp: 'Una CURP mexicana',
  br_cpf: 'Un CPF brasileño',
  br_cnpj: 'Un CNPJ brasileño',
  email_address: 'Un correo electrónico',
  private_key_block: 'Una clave privada de un sistema',
  connection_string: 'La contraseña de una base de datos',
  password_field: 'Una contraseña escrita a pelo'
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
        ? 'Se ejecuta de verdad en esta instalación'
        : 'Instalación de prueba, sin proveedor real';
    } catch {
      this.enVivo = false;
      $('demo-dot').className = 'dot';
      $('demo-mode-label').textContent = 'Ejemplo';
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
      { n: '01', titulo: 'Se comprueba quién pregunta', badge: 'Correcto', tono: 'ok', detalle: 'Cada programa de la empresa tiene su propia llave. Sin ella no pasa.' },
      { n: '02', titulo: 'Se busca si alguien intenta engañar a la IA', badge: 'Limpio', tono: 'ok', detalle: 'Se revisan todos los mensajes de la conversación, no solo el último.' },
      ingress.length > 0
        ? {
          n: '03',
          titulo: 'Se borran los datos de personas',
          badge: `${ingress.length} ${ingress.length === 1 ? 'encontrado' : 'encontrados'}`,
          tono: 'warning',
          detalle: 'Se sustituyen antes de salir. El valor original no se guarda en ningún sitio: en el registro solo queda una huella.',
          hallazgos: ingress.map(d => ({ sigla: NOMBRE_LLANO[d.patternId] ?? d.name, alg: '', valor: d.snippet ?? '' }))
        }
        : { n: '03', titulo: 'Se borran los datos de personas', badge: 'Nada que borrar', detalle: 'En este texto no había ningún documento ni cuenta que reconociera.' },
      {
        n: '04',
        titulo: 'Se añaden vuestras instrucciones',
        badge: data.context?.applied ? 'Después de borrar' : 'No hay ninguna',
        detalle: data.context?.applied
          ? 'El tono y las normas de la casa viajan con cada consulta. Se añaden después del borrado, no antes.'
          : 'No tenéis instrucciones fijas configuradas, así que no se añade nada.'
      },
      data.source === 'cache'
        ? { n: '05', titulo: 'Se mira si ya se preguntó lo mismo', badge: 'Ya estaba', tono: 'ok', detalle: 'Se responde con lo guardado. Esta consulta no ha costado nada.' }
        : { n: '05', titulo: 'Se mira si ya se preguntó lo mismo', badge: 'Es nueva', detalle: 'No estaba guardada, así que hay que preguntar al proveedor.' },
      {
        n: '06',
        titulo: 'Se envía y se anota',
        badge: `${integer(data.latencyMs)} ms`,
        tono: 'probar',
        detalle: `Respondio ${data.model?.label ?? data.model?.id ?? 'el proveedor'}. El envío queda registrado y no se puede borrar sin que se note.`
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
           Ejemplo con datos inventados${avisar ? '. Para verlo funcionar de verdad, instala el gateway y abre <a href="/app">el panel</a>.' : '.'}
         </p>`
      : '';

    $('demo-out').innerHTML = `
      ${pasos}
      <div class="egress">
        <div class="egress-head"><span class="eyebrow">Lo que habría salido de tu empresa</span></div>
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

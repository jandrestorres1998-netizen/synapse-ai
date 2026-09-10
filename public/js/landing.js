import { ApiService } from './services/api.service.js';
import { esc, $ } from './ui.js';

const ETAPAS = [
  {
    n: "01",
    titulo: "Inyección de prompt",
    badge: "Limpio",
    tono: "ok",
    color: "oklch(0.64 0.17 150)",
    fondo: "color-mix(in oklab, oklch(0.64 0.17 150) 14%, white)",
    borde: "color-mix(in oklab, oklch(0.64 0.17 150) 35%, white)",
    detalle: "Sin patrones de anulación de instrucciones en el turno del usuario."
  },
  {
    n: "02",
    titulo: "Redacción DLP",
    badge: "3 hallazgos",
    tono: "warn",
    color: "oklch(0.70 0.18 62)",
    fondo: "color-mix(in oklab, oklch(0.70 0.18 62) 14%, white)",
    borde: "color-mix(in oklab, oklch(0.70 0.18 62) 35%, white)",
    detalle: "Tres identificadores con dígito de control válido, sustituidos antes de la salida.",
    hallazgos: [
      { sigla: "ES_DNI_NIE", alg: "MOD-23", valor: "12345678Z" },
      { sigla: "IBAN", alg: "MOD-97", valor: "ES91 2100 ···· 1332" },
      { sigla: "CARD", alg: "Luhn", valor: "4111 ···· ···· 1111" }
    ]
  },
  {
    n: "03",
    titulo: "Contexto",
    badge: "312 tokens",
    tono: "neutral",
    color: "oklch(0.51 0.028 280)",
    fondo: "oklch(0.963 0.020 280)",
    borde: "oklch(0.905 0.022 280)",
    detalle: "Directriz corporativa inyectada como mensaje de sistema."
  },
  {
    n: "04",
    titulo: "Caché",
    badge: "Sin coincidencia",
    tono: "neutral",
    color: "oklch(0.51 0.028 280)",
    fondo: "oklch(0.963 0.020 280)",
    borde: "oklch(0.905 0.022 280)",
    detalle: "Aislada por inquilino, modelo y contexto. Esta combinación no estaba."
  },
  {
    n: "05",
    titulo: "Enrutado",
    badge: "1.980 ms",
    tono: "probar",
    color: "oklch(0.56 0.20 255)",
    fondo: "color-mix(in oklab, oklch(0.56 0.20 255) 12%, white)",
    borde: "color-mix(in oklab, oklch(0.56 0.20 255) 32%, white)",
    detalle: "gpt-4o-mini · proveedor mock etiquetado · coste registrado en la cadena."
  }
];

const SALIDA = `Redacta un correo al cliente Martín Salas, DNI [REDACTED_ES_DNI_NIE], sobre el cargo pendiente de 1.200 € en su cuenta [REDACTED_IBAN] y la tarjeta [REDACTED_CARD].`;

const CODIGO = {
  python: 'from openai import OpenAI\n\nclient = OpenAI(\n    base_url="https://gateway.tu-dominio.es/v1",   # ← la única línea\n    api_key=os.environ["SYNAPSE_KEY"],\n)',
  node: 'import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "https://gateway.tu-dominio.es/v1",   // ← la única línea\n  apiKey: process.env.SYNAPSE_KEY,\n});',
  curl: 'curl https://gateway.tu-dominio.es/v1/chat/completions \\\n  -H "Authorization: Bearer $SYNAPSE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"auto","messages":[{"role":"user","content":"hola"}]}\''
};

class Landing {
  static init() {
    this.timers = [];
    this.currentLang = 'python';

    this.wireDemo();
    this.wireCodigo();
    this.wireFaq();
    this.renderGhostStages();
  }

  static renderGhostStages() {
    const container = $('demo-stages-container');
    if (!container) return;

    container.innerHTML = `
      <div style="display:grid;gap:12px;padding:8px 0">
        <p style="margin:0;font-size:14px;line-height:1.55;color:oklch(0.61 0.022 280)">Pulsa «Ver qué pasa» para desplegar las cinco etapas: inyección, DLP, contexto, caché y enrutado.</p>
        <div style="display:grid;gap:8px;opacity:0.45">
          ${ETAPAS.map(e => `
            <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px dashed oklch(0.905 0.022 280);border-radius:9px;background:#fff">
              <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:oklch(0.51 0.028 280)">${e.n}</span>
              <span style="font-size:13.5px;color:oklch(0.51 0.028 280)">${esc(e.titulo)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const outBox = $('demo-output-container');
    if (outBox) outBox.style.display = 'none';
  }

  static wireDemo() {
    const btnRun = $('btn-run-demo');
    const btnReset = $('btn-reset-demo');
    const promptInput = $('demo-prompt');
    const stagesContainer = $('demo-stages-container');
    const outBox = $('demo-output-container');
    const outText = $('demo-output-text');

    if (!btnRun || !stagesContainer) return;

    const defaultPrompt = promptInput ? promptInput.value : '';

    btnRun.addEventListener('click', async () => {
      this.clearTimers();
      stagesContainer.innerHTML = '';
      if (outBox) outBox.style.display = 'none';

      btnRun.disabled = true;

      // Check if real gateway can process
      let realData = null;
      try {
        if (promptInput && promptInput.value.trim()) {
          realData = await ApiService.processGateway(promptInput.value.trim(), 'landing').catch(() => null);
        }
      } catch {
        // fallback
      }

      for (let i = 1; i <= ETAPAS.length; i++) {
        this.timers.push(setTimeout(() => {
          this.renderEtapasUpTo(i);
        }, i * 90));
      }

      this.timers.push(setTimeout(() => {
        btnRun.disabled = false;
        if (outBox && outText) {
          outBox.style.display = 'block';
          if (realData && realData.response) {
            outText.textContent = realData.response;
          } else {
            outText.textContent = SALIDA;
          }
        }
      }, (ETAPAS.length + 1) * 90));
    });

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.clearTimers();
        if (promptInput) promptInput.value = defaultPrompt;
        btnRun.disabled = false;
        this.renderGhostStages();
      });
    }
  }

  static clearTimers() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  }

  static renderEtapasUpTo(count) {
    const container = $('demo-stages-container');
    if (!container) return;

    const items = ETAPAS.slice(0, count);
    container.innerHTML = items.map((etapa, idx) => `
      <div style="display:grid;grid-template-columns:30px minmax(0,1fr);gap:14px;animation:etapa 200ms cubic-bezier(0.22,1,0.36,1) both">
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid oklch(0.905 0.022 280);font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:${etapa.color};font-weight:600">${etapa.n}</span>
          ${idx < items.length - 1 ? `<span style="flex:1;width:1px;background:oklch(0.905 0.022 280)"></span>` : ''}
        </div>
        <div style="padding-bottom:${idx < items.length - 1 ? '16px' : '6px'}">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
            <span style="font-weight:600;font-size:15px;color:oklch(0.18 0.05 280)">${esc(etapa.titulo)}</span>
            <span style="padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;background:${etapa.fondo};border:1px solid ${etapa.borde};color:${etapa.color}">${esc(etapa.badge)}</span>
          </div>
          <p style="margin:5px 0 0;font-size:14px;line-height:1.5;color:oklch(0.51 0.028 280)">${esc(etapa.detalle)}</p>
          ${etapa.hallazgos ? `
            <div style="display:grid;gap:6px;margin-top:11px">
              ${etapa.hallazgos.map(h => `
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:9px 12px;border:1px solid oklch(0.938 0.016 280);border-left:3px solid oklch(0.70 0.18 62);border-radius:9px;background:#fff">
                  <span style="font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:oklch(0.24 0.045 280);font-weight:500">${esc(h.sigla)}</span>
                  <span style="font-size:12px;color:oklch(0.61 0.022 280)">${esc(h.alg)}</span>
                  <span style="margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:oklch(0.51 0.028 280)">${esc(h.valor)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  static wireCodigo() {
    const pre = $('code-snippet-pre');
    const copyBtn = $('btn-copy-code');
    const copyText = $('copy-code-text');
    const tabs = document.querySelectorAll('.code-tab-btn');

    const updateSnippet = (lang) => {
      this.currentLang = lang;
      if (pre) pre.textContent = CODIGO[lang] || CODIGO.python;
      tabs.forEach(btn => {
        const active = btn.dataset.lang === lang;
        btn.style.background = active ? 'oklch(0.28 0.040 280)' : 'transparent';
        btn.style.color = active ? 'oklch(0.97 0.010 280)' : 'oklch(0.72 0.020 280)';
      });
    };

    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        updateSnippet(btn.dataset.lang);
      });
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const textToCopy = CODIGO[this.currentLang] || CODIGO.python;
        try {
          await navigator.clipboard.writeText(textToCopy);
          if (copyText) copyText.textContent = 'Copiado';
          copyBtn.style.color = 'oklch(0.78 0.15 150)';
          setTimeout(() => {
            if (copyText) copyText.textContent = 'Copiar';
            copyBtn.style.color = 'oklch(0.88 0.014 280)';
          }, 1400);
        } catch {
          if (copyText) copyText.textContent = 'Error';
          setTimeout(() => { if (copyText) copyText.textContent = 'Copiar'; }, 1400);
        }
      });
    }
  }

  static wireFaq() {
    const items = document.querySelectorAll('.faq-item');
    items.forEach((item, idx) => {
      const btn = item.querySelector('.faq-btn');
      const body = item.querySelector('.faq-body');
      const icon = item.querySelector('.faq-icon');

      if (idx === 0 && body) {
        body.style.display = 'block';
        if (icon) icon.style.transform = 'rotate(180deg)';
      }

      btn?.addEventListener('click', () => {
        const isOpen = body && body.style.display === 'block';
        items.forEach(other => {
          const b = other.querySelector('.faq-body');
          const ic = other.querySelector('.faq-icon');
          if (b) b.style.display = 'none';
          if (ic) ic.style.transform = 'rotate(0deg)';
        });

        if (!isOpen && body) {
          body.style.display = 'block';
          if (icon) icon.style.transform = 'rotate(180deg)';
        }
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => Landing.init());

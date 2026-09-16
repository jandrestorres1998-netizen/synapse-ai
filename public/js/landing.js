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

    container.replaceChildren();

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:12px;padding:8px 0';

    const p = document.createElement('p');
    p.style.cssText = 'margin:0;font-size:14px;line-height:1.55;color:oklch(0.61 0.022 280)';
    p.textContent = 'Pulsa «Ver qué pasa» para desplegar las cinco etapas: inyección, DLP, contexto, caché y enrutado.';
    wrap.appendChild(p);

    const list = document.createElement('div');
    list.style.cssText = 'display:grid;gap:8px;opacity:0.45';

    ETAPAS.forEach(e => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px dashed oklch(0.905 0.022 280);border-radius:9px;background:#fff';

      const num = document.createElement('span');
      num.style.cssText = "font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:oklch(0.51 0.028 280)";
      num.textContent = e.n;

      const title = document.createElement('span');
      title.style.cssText = 'font-size:13.5px;color:oklch(0.51 0.028 280)';
      title.textContent = e.titulo;

      item.appendChild(num);
      item.appendChild(title);
      list.appendChild(item);
    });

    wrap.appendChild(list);
    container.appendChild(wrap);

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
      stagesContainer.replaceChildren();
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

    container.replaceChildren();

    const items = ETAPAS.slice(0, count);
    items.forEach((etapa, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:30px minmax(0,1fr);gap:14px;animation:etapa 200ms cubic-bezier(0.22,1,0.36,1) both';

      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px';

      const nBadge = document.createElement('span');
      nBadge.style.cssText = `display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:#fff;border:1px solid oklch(0.905 0.022 280);font-family:'DM Mono',ui-monospace,monospace;font-size:12px;color:${etapa.color};font-weight:600`;
      nBadge.textContent = etapa.n;
      leftCol.appendChild(nBadge);

      if (idx < items.length - 1) {
        const line = document.createElement('span');
        line.style.cssText = 'flex:1;width:1px;background:oklch(0.905 0.022 280)';
        leftCol.appendChild(line);
      }

      const rightCol = document.createElement('div');
      rightCol.style.paddingBottom = idx < items.length - 1 ? '16px' : '6px';

      const head = document.createElement('div');
      head.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px';

      const title = document.createElement('span');
      title.style.cssText = 'font-weight:600;font-size:15px;color:oklch(0.18 0.05 280)';
      title.textContent = etapa.titulo;

      const badge = document.createElement('span');
      badge.style.cssText = `padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;background:${etapa.fondo};border:1px solid ${etapa.borde};color:${etapa.color}`;
      badge.textContent = etapa.badge;

      head.appendChild(title);
      head.appendChild(badge);
      rightCol.appendChild(head);

      const p = document.createElement('p');
      p.style.cssText = 'margin:5px 0 0;font-size:14px;line-height:1.5;color:oklch(0.51 0.028 280)';
      p.textContent = etapa.detalle;
      rightCol.appendChild(p);

      if (etapa.hallazgos) {
        const findings = document.createElement('div');
        findings.style.cssText = 'display:grid;gap:6px;margin-top:11px';

        etapa.hallazgos.forEach(h => {
          const card = document.createElement('div');
          card.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:9px 12px;border:1px solid oklch(0.938 0.016 280);border-left:3px solid oklch(0.70 0.18 62);border-radius:9px;background:#fff';

          const sigla = document.createElement('span');
          sigla.style.cssText = "font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:oklch(0.24 0.045 280);font-weight:500";
          sigla.textContent = h.sigla;

          const alg = document.createElement('span');
          alg.style.cssText = 'font-size:12px;color:oklch(0.61 0.022 280)';
          alg.textContent = h.alg;

          const val = document.createElement('span');
          val.style.cssText = "margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:oklch(0.51 0.028 280)";
          val.textContent = h.valor;

          card.appendChild(sigla);
          card.appendChild(alg);
          card.appendChild(val);
          findings.appendChild(card);
        });

        rightCol.appendChild(findings);
      }

      row.appendChild(leftCol);
      row.appendChild(rightCol);
      container.appendChild(row);
    });
  }

  static wireCodigo() {
    const pre = $('code-snippet-pre');
    const copyBtn = $('btn-copy-code');
    const copyText = $('copy-code-text');
    const tabs = document.querySelectorAll('.code-tab-btn');

    const updateSnippet = (lang) => {
      this.currentLang = lang;
      if (pre) {
        pre.classList.remove('anim-swap');
        void pre.offsetWidth; // Reflow trigger
        pre.textContent = CODIGO[lang] || CODIGO.python;
        pre.classList.add('anim-swap');
      }
      tabs.forEach(btn => {
        const active = btn.dataset.lang === lang;
        btn.classList.toggle('active', active);
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
          copyBtn.classList.add('pulse-pop');
          setTimeout(() => {
            if (copyText) copyText.textContent = 'Copiar';
            copyBtn.style.color = 'oklch(0.88 0.014 280)';
            copyBtn.classList.remove('pulse-pop');
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

      // First item open by default
      if (idx === 0) {
        item.classList.add('is-open');
        if (body) body.style.display = '';
      } else if (body) {
        body.style.display = '';
      }

      btn?.addEventListener('click', () => {
        const isOpen = item.classList.contains('is-open');
        items.forEach(other => {
          other.classList.remove('is-open');
        });
        if (!isOpen) {
          item.classList.add('is-open');
        }
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => Landing.init());

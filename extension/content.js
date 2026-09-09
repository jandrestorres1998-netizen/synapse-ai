/**
 * SynapseAI prompt interceptor.
 *
 * The previous version only watched the user type and showed a badge after the
 * fact — the secret still travelled to the model when Enter was pressed. This
 * one intercepts the send action itself, in the capture phase, before the host
 * page's own handler runs, and gives the user a decision: redact, send anyway,
 * or cancel.
 *
 * Limits, stated plainly:
 *  - Detection is regex plus checksums. It catches structured secrets pasted by
 *    accident. It does not understand confidential prose.
 *  - It hooks the editor and the visible send button. A site can always add a
 *    path this script does not know about (a shortcut, a drag-and-drop, an
 *    upload), and a redesign can break the hook overnight. This is a seatbelt,
 *    not a network boundary. Enforcement that cannot be bypassed has to live
 *    where the traffic is: a proxy or a managed browser policy.
 */

const { scan } = globalThis.SynapseDLP;

const EDITOR_SELECTORS = [
  'textarea',
  'div[contenteditable="true"]',
  'p[contenteditable="true"]'
].join(',');

const state = {
  allowNextSend: false,
  lastDecisionAt: 0
};

function readEditor(el) {
  return el.tagName === 'TEXTAREA' ? el.value : el.innerText;
}

function writeEditor(el, text) {
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, text);
  } else {
    el.innerText = text;
  }
  // React and friends listen for input events, not property writes.
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function findEditor(target) {
  return target?.closest?.(EDITOR_SELECTORS) ?? null;
}

// ── Modal ────────────────────────────────────────────────────────────────────

function buildModal(findings, onDecision) {
  const host = document.createElement('div');
  host.id = 'synapse-guard-modal';
  // Shadow DOM so the host page's CSS cannot restyle or hide the warning.
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      .backdrop { position: fixed; inset: 0; background: rgba(2,6,23,.72); z-index: 2147483647;
                  display: flex; align-items: center; justify-content: center;
                  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      .panel { background: #0f172a; color: #e2e8f0; border: 1px solid #38bdf8;
               border-radius: 12px; max-width: 460px; width: calc(100% - 32px); padding: 22px;
               box-shadow: 0 18px 50px rgba(0,0,0,.55); }
      h2 { margin: 0 0 6px; font-size: 1rem; color: #f8fafc; }
      p  { margin: 0 0 14px; font-size: .82rem; color: #94a3b8; line-height: 1.5; }
      ul { margin: 0 0 16px; padding-left: 18px; font-size: .82rem; }
      li { margin-bottom: 5px; }
      .critical { color: #fda4af; }
      .high { color: #fcd34d; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      button { border-radius: 7px; padding: 9px 14px; font-size: .8rem; font-weight: 600;
               cursor: pointer; border: 1px solid transparent; }
      .primary { background: #38bdf8; color: #04263a; }
      .ghost { background: transparent; color: #cbd5e1; border-color: #334155; }
      .danger { background: transparent; color: #fda4af; border-color: #7f1d1d; }
    </style>
    <div class="backdrop" role="dialog" aria-modal="true">
      <div class="panel">
        <h2>🛡️ Datos sensibles detectados</h2>
        <p>Este mensaje contiene información que normalmente no debería enviarse a un servicio de IA externo.</p>
        <ul>
          ${findings.map(f => `<li class="${f.severity}">${f.name}</li>`).join('')}
        </ul>
        <div class="actions">
          <button class="primary" data-action="redact">Enmascarar y enviar</button>
          <button class="ghost" data-action="cancel">Cancelar</button>
          <button class="danger" data-action="send">Enviar sin cambios</button>
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      host.remove();
      onDecision(button.dataset.action);
    });
  });

  document.documentElement.appendChild(host);
  root.querySelector('.primary').focus();
}

// ── Interception ─────────────────────────────────────────────────────────────

/**
 * @returns {boolean} true when the send must be stopped.
 */
function interceptSend(editor, resume) {
  const text = readEditor(editor);
  if (!text || text.length < 8) return false;

  const { findings, redacted } = scan(text);
  if (findings.length === 0) return false;

  buildModal(findings, action => {
    if (action === 'cancel') return;

    if (action === 'redact') writeEditor(editor, redacted);

    reportToGateway(findings, action);

    // The user has decided; let the next send through untouched.
    state.allowNextSend = true;
    state.lastDecisionAt = Date.now();
    setTimeout(resume, 0);
  });

  return true;
}

/** A decision is only valid for the send that immediately follows it. */
function consumeAllowance() {
  if (!state.allowNextSend) return false;
  const fresh = Date.now() - state.lastDecisionAt < 10_000;
  state.allowNextSend = false;
  return fresh;
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

  const editor = findEditor(event.target);
  if (!editor) return;
  if (consumeAllowance()) return;

  const blocked = interceptSend(editor, () => {
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
  });

  if (blocked) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true); // capture: runs before the page's own handler

document.addEventListener('click', event => {
  const button = event.target.closest?.('button, [role="button"]');
  if (!button) return;

  const label = `${button.getAttribute('aria-label') ?? ''} ${button.dataset.testid ?? ''}`.toLowerCase();
  if (!/send|enviar|submit/.test(label)) return;
  if (consumeAllowance()) return;

  const editor = document.querySelector(EDITOR_SELECTORS);
  if (!editor) return;

  const blocked = interceptSend(editor, () => button.click());
  if (blocked) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

// ── Optional audit reporting ─────────────────────────────────────────────────

/**
 * Reports the *shape* of the event to the local gateway: rule ids and the
 * user's decision, never the text. Routed through the service worker because a
 * content-script fetch would be blocked by the host page's CORS policy.
 */
function reportToGateway(findings, decision) {
  try {
    chrome.runtime.sendMessage({
      type: 'synapse:report',
      payload: {
        host: location.hostname,
        decision,
        rules: findings.map(f => ({ id: f.id, severity: f.severity })),
        occurredAt: new Date().toISOString()
      }
    });
  } catch {
    // Extension context invalidated (reload/update): never block the user.
  }
}

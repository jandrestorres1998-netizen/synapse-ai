/**
 * Helpers de presentación compartidos.
 *
 * Todo lo que llega de la API pasa por `esc` antes de tocar el DOM: el texto
 * viene de prompts, nombres de directrices y cabeceras que escribe cualquiera
 * que use el gateway.
 */

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function $(id) {
  return document.getElementById(id);
}

export function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

export function setHTML(id, value) {
  const el = $(id);
  if (el) el.innerHTML = value;
}

/** Importes pequeños necesitan más decimales de los que usaría una moneda. */
export function money(usd, { compact = false } = {}) {
  const n = Number(usd) || 0;
  if (compact) return `$${n.toFixed(2)}`;
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

export function integer(n) {
  return new Intl.NumberFormat('es-ES').format(Math.round(Number(n) || 0));
}

export function time(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-ES', { hour12: false });
}

/** Iconos en trazo, sin emoji: escalan y se recolorean con currentColor. */
export const icon = {
  check: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  shield: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  book: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
  route: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
  bolt: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>',
  stop: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  alert: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>',
  info: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
};

/**
 * Aviso con su tono. `tone` es semántico, no decorativo: ok, warning,
 * critical o vacío para neutro.
 */
export function notice({ tone = '', title, text, iconName = 'info' }) {
  return `
    <div class="notice ${tone}">
      <span class="notice-icon">${icon[iconName] ?? icon.info}</span>
      <div class="notice-body">
        <span class="notice-title">${esc(title)}</span>
        ${text ? `<span class="notice-text">${text}</span>` : ''}
      </div>
    </div>`;
}

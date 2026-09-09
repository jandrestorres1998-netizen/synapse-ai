import { ApiService } from '../services/api.service.js';
import { esc, $, setHTML, money, notice } from '../ui.js';

const PROVIDER_LABEL = {
  openai: { name: 'OpenAI', note: 'GPT-4o y GPT-4o mini' },
  anthropic: { name: 'Anthropic', note: 'Claude Sonnet y Haiku' },
  google: { name: 'Google', note: 'Gemini 2.0 Flash' },
  ollama: { name: 'Ollama (local)', note: 'Inferencia dentro de tu perímetro' },
  mock: { name: 'Proveedor mock', note: 'Devuelve texto sintético: solo para desarrollo' }
};

/**
 * Ajustes: proveedores, presupuesto y cómo conectar una aplicación.
 *
 * El estado del vault se muestra tal cual lo reporta la API, incluido el aviso
 * del modo reducido. Un panel que dice «AES-256-GCM» sin decir de dónde sale la
 * clave está describiendo el algoritmo, no la protección.
 */
export class AjustesComponent {
  static async render() {
    await Promise.all([this.renderProviders(), this.renderBudget()]);
    this.renderSnippet();
  }

  static async renderProviders() {
    const list = $('provider-list');
    if (!list) return;

    try {
      const [vault, stats] = await Promise.all([ApiService.getVaultStatus(), ApiService.getStats()]);

      setHTML('vault-warning', vault.warning
        ? notice({
          tone: 'warning',
          iconName: 'alert',
          title: 'El cifrado en reposo está en modo reducido',
          text: esc(vault.warning)
        })
        : notice({
          tone: 'ok',
          iconName: 'check',
          title: 'Vault con clave maestra propia',
          text: 'Las credenciales están cifradas con una clave que vive fuera de este disco.'
        }));

      const providers = stats.providers ?? {};
      list.innerHTML = Object.entries(providers)
        .filter(([name]) => name !== 'mock' || providers.mock?.configured)
        .map(([name, state]) => {
          const meta = PROVIDER_LABEL[name] ?? { name, note: '' };
          const source = { vault: 'Guardada en el vault', env: 'Desde variable de entorno', local: 'Servicio local' }[state.source];

          return `
            <div class="row${state.configured ? '' : ' empty'}">
              <div class="row-main">
                <span class="dot ${state.configured ? 'ok' : ''}"></span>
                <div class="row-text">
                  <span class="row-title">${esc(meta.name)}</span>
                  <span class="row-note">${state.configured ? esc(meta.note) : esc(this.emptyNote(name))}</span>
                </div>
              </div>
              <div class="row-actions">
                ${state.configured ? `<span class="row-note">${esc(source ?? '')}</span>` : ''}
                ${this.needsCredential(name)
                  ? `<button class="btn btn-secondary" data-provider="${esc(name)}">${state.configured ? 'Cambiar' : 'Añadir clave'}</button>`
                  : ''}
              </div>
            </div>`;
        }).join('');

      list.querySelectorAll('[data-provider]').forEach(button =>
        button.addEventListener('click', () => this.setKey(button.dataset.provider)));
    } catch (err) {
      list.innerHTML = err.code === 401
        ? '<div class="table-empty">Introduce tu clave de API para gestionar los proveedores.</div>'
        : `<div class="table-empty">${esc(err.message)}</div>`;
    }
  }

  /** Ollama y el mock corren en local: no hay credencial que pedir. */
  static needsCredential(provider) {
    return !['ollama', 'mock'].includes(provider);
  }

  static emptyNote(provider) {
    if (provider === 'ollama') return 'No responde en la URL configurada. Arranca el servicio para usarlo.';
    return 'Sin credencial. El router no lo elegirá.';
  }

  static async setKey(provider) {
    const key = prompt(`Pega la credencial de ${PROVIDER_LABEL[provider]?.name ?? provider}.\n\nSe guardará cifrada y no volverá a mostrarse.`);
    if (!key) return;

    try {
      const result = await ApiService.setVaultKey(provider, key.trim());
      if (result.verification?.attempted && !result.verification.ok) {
        alert(`Guardada, pero el proveedor la rechazó:\n\n${result.verification.error}`);
      }
      this.render();
    } catch (err) {
      alert(err.message);
    }
  }

  static async renderBudget() {
    const card = $('budget-card');
    if (!card) return;

    try {
      const budget = await ApiService.getBudget();
      const period = (scope, label) => {
        const daily = budget[scope].daily;
        const monthly = budget[scope].monthly;
        return `
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <span class="card-title">${label}</span>
            ${[['Hoy', daily], ['Este mes', monthly]].map(([name, p]) => `
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <div class="breakdown-head">
                  <span>${name}</span>
                  <span class="num">${money(p.spentUsd)}${p.enforced ? ` <span style="color: var(--ink-faint);">/ ${money(p.limitUsd, { compact: true })}</span>` : ''}</span>
                </div>
                ${p.enforced
                  ? `<div class="bar"><span style="width: ${Math.min(100, ((p.spentUsd + p.reservedUsd) / p.limitUsd) * 100)}%"></span></div>`
                  : '<span class="metric-note">Sin tope: se contabiliza, no se detiene.</span>'}
              </div>`).join('')}
          </div>`;
      };

      card.innerHTML = `
        <div class="split" style="gap: 24px;">
          ${period('tenant', 'Tu clave')}
          ${period('global', 'Todas las claves')}
        </div>
        ${budget.note ? `<p class="metric-note" style="margin: 0;">${esc(budget.note)} Configúralos con <code>SYNAPSE_BUDGET_DAILY_USD</code> y <code>SYNAPSE_BUDGET_MONTHLY_USD</code>.</p>` : ''}`;
    } catch (err) {
      card.innerHTML = err.code === 401
        ? '<span class="metric-note">Introduce tu clave de API para ver el presupuesto.</span>'
        : `<span class="metric-note">${esc(err.message)}</span>`;
    }
  }

  static renderSnippet() {
    const el = $('snippet');
    if (!el) return;

    el.textContent = `from openai import OpenAI

client = OpenAI(
    base_url="${location.origin}/v1",
    api_key="<tu clave de Synapse>",
)

client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hola"}],
)`;
  }
}

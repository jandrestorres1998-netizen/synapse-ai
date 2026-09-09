import { ApiService } from '../services/api.service.js';
import { esc, $, setHTML, money, integer, notice } from '../ui.js';

const PROVIDER_LABEL = {
  openai: { name: 'OpenAI', note: 'GPT-4o y GPT-4o mini' },
  anthropic: { name: 'Anthropic', note: 'Claude Sonnet y Haiku' },
  google: { name: 'Google', note: 'Gemini Flash' },
  ollama: { name: 'Ollama (local)', note: 'Inferencia dentro de tu perímetro' },
  mock: { name: 'Proveedor mock', note: 'Devuelve texto sintético: solo para desarrollo' }
};

const SOURCE_LABEL = {
  vault: 'Guardada en el vault',
  env: 'Desde variable de entorno',
  local: 'Servicio local'
};

/**
 * Ajustes: proveedores, presupuesto, auditoría y cómo conectar una aplicación.
 *
 * El estado del vault se muestra tal cual lo reporta la API, incluido el aviso
 * del modo reducido. Un panel que dice «AES-256-GCM» sin decir de dónde sale la
 * clave está describiendo el algoritmo, no la protección.
 */
export class AjustesComponent {
  static async render() {
    await Promise.all([this.renderProviders(), this.renderBudget(), this.renderAudit()]);
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
                ${state.configured ? `<span class="row-note">${esc(SOURCE_LABEL[state.source] ?? '')}</span>` : ''}
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

      const period = (scope, label) => `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <span class="card-title">${label}</span>
          ${[['Hoy', budget[scope].daily], ['Este mes', budget[scope].monthly]].map(([name, p]) => `
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

      card.innerHTML = `
        <div class="split">
          ${period('tenant', 'Tu clave')}
          ${period('global', 'Todas las claves')}
        </div>
        ${budget.note ? `<p class="metric-note" style="margin: 14px 0 0;">${esc(budget.note)} Configúralos con <code>SYNAPSE_BUDGET_DAILY_USD</code> y <code>SYNAPSE_BUDGET_MONTHLY_USD</code>.</p>` : ''}`;
    } catch (err) {
      card.innerHTML = err.code === 401
        ? '<span class="metric-note">Introduce tu clave de API para ver el presupuesto.</span>'
        : `<span class="metric-note">${esc(err.message)}</span>`;
    }
  }

  /**
   * Dos garantías distintas que es fácil confundir, así que se nombran aparte:
   * la CADENA de auditoría (cada entrada referencia el hash de la anterior) y
   * los FICHEROS del servidor contra su manifiesto. Un botón único que dijera
   * «verificar» sin decir qué verifica sería peor que no tenerlo.
   *
   * Ambas se lanzan a mano, no en cada refresco: recorren el fichero completo.
   */
  static async renderAudit() {
    const card = $('audit-card');
    if (!card) return;

    card.innerHTML = `
      <p class="metric-note" style="margin: 0 0 14px;">Cada entrada referencia el hash de la anterior, así que un borrado o una edición rompen la cadena y se detectan al verificarla.</p>
      <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        <button class="btn btn-secondary" id="btn-verify-chain" type="button">Verificar la cadena</button>
        <button class="btn btn-secondary" id="btn-verify-files" type="button">Verificar los ficheros del servidor</button>
        <button class="btn btn-secondary" id="btn-export-csv" type="button">Exportar CSV</button>
      </div>
      <div id="audit-result" style="margin-top: 14px;"></div>`;

    $('btn-verify-chain')?.addEventListener('click', async () => {
      setHTML('audit-result', '<span class="metric-note">Recorriendo la cadena…</span>');
      try {
        const { ledger } = await ApiService.getSecurityLogs();
        const integrity = ledger?.integrity ?? {};

        setHTML('audit-result', integrity.isValid
          ? notice({
            tone: 'ok',
            iconName: 'check',
            title: 'La cadena verifica',
            text: `${integer(ledger.totalAppended)} registros encadenados, sin cortes. ${esc(integrity.scope ?? '')}`
          })
          : notice({
            tone: 'critical',
            iconName: 'alert',
            title: 'La cadena no verifica',
            text: esc(integrity.reason ?? 'Revisa el fichero de auditoría.')
          }));
      } catch (err) {
        setHTML('audit-result', notice({ tone: 'critical', iconName: 'alert', title: 'No se pudo verificar la cadena', text: esc(err.message) }));
      }
    });

    $('btn-verify-files')?.addEventListener('click', async () => {
      setHTML('audit-result', '<span class="metric-note">Comparando ficheros con el manifiesto…</span>');
      try {
        const result = await ApiService.getIntegrity();

        setHTML('audit-result', result.isValid
          ? notice({
            tone: 'ok',
            iconName: 'check',
            title: 'Los ficheros coinciden con el manifiesto',
            text: `${integer(result.totalChecked ?? 0)} ficheros comprobados. Esto dice que el código no ha cambiado; no dice nada sobre la cadena de auditoría.`
          })
          : notice({
            tone: 'critical',
            iconName: 'alert',
            title: 'Hay ficheros que no coinciden',
            text: result.tamperedFiles?.length
              ? esc(result.tamperedFiles.map(f => `${f.file} (${f.issue})`).join(', '))
              : esc(result.status ?? '')
          }));
      } catch (err) {
        setHTML('audit-result', notice({ tone: 'critical', iconName: 'alert', title: 'No se pudo verificar', text: esc(err.message) }));
      }
    });

    $('btn-export-csv')?.addEventListener('click', async () => {
      try {
        const blob = await ApiService.exportSecurityLogs('csv');
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: 'synapse-auditoria.csv' }).click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(`No se pudo exportar: ${err.message}`);
      }
    });
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

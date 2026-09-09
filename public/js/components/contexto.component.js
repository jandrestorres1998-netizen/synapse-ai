import { ApiService } from '../services/api.service.js';
import { esc, $, setText, integer } from '../ui.js';

/**
 * Contexto: las directrices que se inyectan en cada petición.
 *
 * Se muestra el tamaño total porque cuenta como tokens de entrada en TODAS las
 * peticiones: una directriz larga que nadie revisa es un coste recurrente
 * invisible.
 */
export class ContextoComponent {
  static init() {
    $('btn-add-memory')?.addEventListener('click', () => this.create());
  }

  static async render() {
    const list = $('memory-list');
    if (!list) return;

    try {
      const memories = await ApiService.getMemories();

      const activeChars = memories
        .filter(m => m.isActive)
        .reduce((total, m) => total + m.title.length + m.content.length + 4, 0);
      setText('context-size', `${integer(activeChars)} caracteres en cada petición`);

      if (memories.length === 0) {
        list.innerHTML = '<div class="table-empty">Sin directrices. El gateway no añadirá contexto.</div>';
        return;
      }

      list.innerHTML = memories.map(m => `
        <div class="row${m.isActive ? '' : ' empty'}">
          <div class="row-main">
            <span class="dot ${m.isActive ? 'ok' : ''}"></span>
            <div class="row-text">
              <span class="row-title">${esc(m.title)} <span class="tag">${esc(m.category)}</span></span>
              <span class="row-note">${esc(m.content)}</span>
              <span class="row-note num">${integer(m.title.length + m.content.length + 4)} caracteres${m.isActive ? ' en cada petición' : ' · no se inyecta'}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn btn-quiet" data-toggle="${esc(m.id)}">${m.isActive ? 'Desactivar' : 'Activar'}</button>
            <button class="btn btn-quiet btn-danger" data-delete="${esc(m.id)}">Eliminar</button>
          </div>
        </div>`).join('');

      list.querySelectorAll('[data-toggle]').forEach(button =>
        button.addEventListener('click', () => this.toggle(button.dataset.toggle)));
      list.querySelectorAll('[data-delete]').forEach(button =>
        button.addEventListener('click', () => this.remove(button.dataset.delete)));
    } catch (err) {
      list.innerHTML = err.code === 401
        ? '<div class="table-empty">Introduce tu clave de API para ver las directrices.</div>'
        : `<div class="table-empty">${esc(err.message)}</div>`;
    }
  }

  static async create() {
    const title = $('mem-title').value.trim();
    const content = $('mem-content').value.trim();
    const category = $('mem-category').value.trim() || 'General';

    if (!title || !content) {
      alert('El título y el contenido son obligatorios.');
      return;
    }

    try {
      await ApiService.createMemory({ title, content, category, isActive: true });
      $('mem-title').value = '';
      $('mem-content').value = '';
      $('mem-category').value = '';
      this.render();
    } catch (err) {
      alert(err.message);
    }
  }

  static async toggle(id) {
    try {
      await ApiService.toggleMemory(id);
      this.render();
    } catch (err) {
      alert(err.message);
    }
  }

  static async remove(id) {
    if (!confirm('¿Eliminar esta directriz? Dejará de inyectarse en las peticiones.')) return;
    try {
      await ApiService.deleteMemory(id);
      this.render();
    } catch (err) {
      alert(err.message);
    }
  }
}

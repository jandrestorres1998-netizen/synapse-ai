import { ApiService } from '../services/api.service.js';

export class MemoryComponent {
  static init() {
    window.loadMemories = this.render.bind(this);
    window.createNewMemory = this.createNewMemory.bind(this);
    window.toggleMemory = this.toggleMemory.bind(this);
    window.deleteMemory = this.deleteMemory.bind(this);
  }

  static async render() {
    try {
      const memories = await ApiService.getMemories();
      const container = document.getElementById('memory-items-container');

      if (!memories || memories.length === 0) {
        container.innerHTML = `<div class="text-muted">No hay memorias registradas. Agrega una arriba.</div>`;
        return;
      }

      container.innerHTML = memories.map(mem => `
        <div class="memory-card-item ${mem.isActive ? 'active' : ''}">
          <div class="mem-body">
            <div class="mem-meta">
              <span class="mem-category-tag">${mem.category}</span>
              <span class="mem-title">${this._escapeHtml(mem.title)}</span>
            </div>
            <div class="mem-desc">${this._escapeHtml(mem.content)}</div>
          </div>
          <div class="mem-actions">
            <button class="btn btn-sm ${mem.isActive ? 'btn-outline' : 'btn-secondary'}" onclick="toggleMemory('${mem.id}')">
              ${mem.isActive ? '✓ Activo' : 'Pausado'}
            </button>
            <button class="btn-icon" onclick="deleteMemory('${mem.id}')" title="Eliminar">🗑️</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('[MemoryComponent] Error:', err);
    }
  }

  static async createNewMemory() {
    const title = document.getElementById('new-mem-title').value.trim();
    const category = document.getElementById('new-mem-category').value;
    const content = document.getElementById('new-mem-content').value.trim();

    if (!title || !content) {
      alert('Por favor ingresa un título y el contenido del contexto.');
      return;
    }

    try {
      await ApiService.createMemory({ title, category, content, isActive: true });
      document.getElementById('new-mem-title').value = '';
      document.getElementById('new-mem-content').value = '';
      this.render();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  }

  static async toggleMemory(id) {
    try {
      await ApiService.toggleMemory(id);
      this.render();
    } catch (err) {
      console.error('[MemoryComponent] Error toggling:', err);
    }
  }

  static async deleteMemory(id) {
    if (!confirm('¿Seguro que deseas eliminar este bloque de memoria?')) return;
    try {
      await ApiService.deleteMemory(id);
      this.render();
    } catch (err) {
      console.error('[MemoryComponent] Error deleting:', err);
    }
  }

  static _escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
}

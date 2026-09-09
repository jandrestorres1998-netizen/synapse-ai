import crypto from 'crypto';
import path from 'path';
import { JsonStore } from './store/json-store.js';

const DEFAULT_MEMORIES = [
  {
    id: 'mem_corporate_guidelines',
    title: 'Directrices corporativas y tono',
    category: 'Empresa',
    content: 'Responde con precisión profesional. Prioriza código limpio, seguro y verificable. No inventes datos que no estén en el contexto.',
    isActive: true,
    updatedAt: new Date().toISOString()
  }
];

/**
 * Corporate context injected as a system prompt on every request.
 *
 * Records live on disk: previously they were an in-memory array, so every
 * directive an operator configured disappeared on restart while the dashboard
 * kept presenting them as persistent policy.
 */
export class MemoryHub {
  constructor({ dataDir, seed = DEFAULT_MEMORIES } = {}) {
    this.store = new JsonStore(path.join(dataDir, 'memories.json'), seed);
  }

  getAll() {
    return this.store.all();
  }

  /**
   * Concatenated active directives, or an empty string.
   * Capped because the context is prepended to every single request and a
   * runaway memory hub silently multiplies the input-token bill.
   */
  getActiveContext(maxChars = 8000) {
    const context = this.store.all()
      .filter(m => m.isActive)
      .map(m => `[${m.title}]: ${m.content}`)
      .join('\n');

    return context.length > maxChars ? context.slice(0, maxChars) + '\n[…contexto truncado]' : context;
  }

  add({ title, content, category = 'General', isActive = true }) {
    return this.store.insert({
      id: 'mem_' + crypto.randomBytes(5).toString('hex'),
      title,
      category,
      content,
      isActive,
      updatedAt: new Date().toISOString()
    });
  }

  toggle(id) {
    return this.store.update(id, record => {
      record.isActive = !record.isActive;
      record.updatedAt = new Date().toISOString();
    });
  }

  update(id, { title, content, category, isActive }) {
    return this.store.update(id, record => {
      if (title !== undefined) record.title = title;
      if (content !== undefined) record.content = content;
      if (category !== undefined) record.category = category;
      if (isActive !== undefined) record.isActive = isActive;
      record.updatedAt = new Date().toISOString();
    });
  }

  delete(id) {
    return this.store.remove(id);
  }
}

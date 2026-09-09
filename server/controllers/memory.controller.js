import { memory } from '../config/container.js';

export function getAllMemories(req, res) {
  res.json(memory.getAll());
}

export function createMemory(req, res) {
  const { title, content, category, isActive } = req.body;
  res.status(201).json(memory.add({ title, content, category, isActive }));
}

export function updateMemory(req, res) {
  const updated = memory.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: { message: 'Memoria no encontrada', code: 404 } });
  res.json(updated);
}

export function toggleMemory(req, res) {
  const updated = memory.toggle(req.params.id);
  if (!updated) return res.status(404).json({ error: { message: 'Memoria no encontrada', code: 404 } });
  res.json(updated);
}

export function deleteMemory(req, res) {
  const deleted = memory.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: { message: 'Memoria no encontrada', code: 404 } });
  res.status(204).end();
}

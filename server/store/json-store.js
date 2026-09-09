import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Small durable JSON collection backed by a single file.
 *
 * Writes go to a temporary file and are renamed into place, so a crash mid-write
 * leaves the previous version intact rather than a truncated file. This is not a
 * database: it assumes one process and a collection small enough to hold in
 * memory, which matches the single-tenant self-hosted deployment this gateway
 * targets. Multi-process or multi-node deployments need a real store.
 */
export class JsonStore {
  /**
   * @param {string} filePath
   * @param {Array}  seed Initial records written only when the file does not exist.
   */
  constructor(filePath, seed = []) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (fs.existsSync(filePath)) {
      this.records = this._read();
    } else {
      this.records = seed;
      this._write();
    }
  }

  _read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // A corrupt file is preserved for inspection rather than silently discarded.
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      try { fs.renameSync(this.filePath, backup); } catch { /* best effort */ }
      return [];
    }
  }

  _write() {
    const tmp = `${this.filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.records, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  all() {
    return this.records;
  }

  find(predicate) {
    return this.records.find(predicate) ?? null;
  }

  insert(record) {
    this.records.unshift(record);
    this._write();
    return record;
  }

  update(id, mutate) {
    const record = this.records.find(r => r.id === id);
    if (!record) return null;
    mutate(record);
    this._write();
    return record;
  }

  remove(id) {
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) return false;
    this.records.splice(index, 1);
    this._write();
    return true;
  }
}

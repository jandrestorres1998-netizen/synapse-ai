import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../config/logger.js';

const log = createLogger('AuditLedger');

/**
 * Hash-chained audit ledger for security events.
 *
 * Each record embeds the hash of its predecessor, so removing or editing a
 * record in the middle of the chain invalidates every hash after it.
 *
 * What this actually gives you, stated plainly:
 *  - It detects accidental corruption and after-the-fact edits by anyone who
 *    cannot recompute the chain.
 *  - With SYNAPSE_AUDIT_HMAC_KEY set, records are also authenticated, so an
 *    attacker who can rewrite the log file but cannot read that key is unable
 *    to forge a valid chain.
 *  - It does NOT protect against an attacker who owns the process at the time
 *    events are written, and it is not a blockchain, a notarization service or
 *    a zero-knowledge proof. For adversarial-operator guarantees the ledger has
 *    to be shipped to an append-only store you control separately (SIEM, WORM
 *    bucket, external timestamping authority).
 */
export class AuditChainLedger {
  /**
   * @param {Object} options
   * @param {string|null} options.filePath  Append-only JSONL sink; null keeps the chain in memory only.
   * @param {string}      options.hmacKey   Optional key that authenticates each record.
   * @param {number}      options.maxInMemory
   */
  constructor({ filePath = null, hmacKey = '', maxInMemory = 2000 } = {}) {
    this.chain = [];
    this.filePath = filePath;
    this.hmacKey = hmacKey;
    this.maxInMemory = maxInMemory;
    this.genesisHash = '0'.repeat(64);
    this.totalAppended = 0;

    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this._restoreTail();
    }
  }

  /** Parses every record in the ledger file. */
  _readAll() {
    return fs.readFileSync(this.filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  /**
   * Reloads the tail of the chain so a restart continues it, and verifies the
   * whole file while doing so.
   *
   * Loading the last N records and trusting them was exploitable: an attacker
   * could delete the beginning of the ledger, and because the record count was
   * derived from the surviving lines, the next integrity check reported a valid
   * chain over evidence that no longer existed.
   */
  _restoreTail() {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const records = this._readAll();
      const verdict = this._verifyRecords(records);

      this.startupIntegrity = verdict;
      if (!verdict.isValid) {
        log.error('La cadena de auditoría en disco no supera la verificación de integridad', verdict);
      }

      this.chain = records.slice(-this.maxInMemory);
      // Taken from the last record's own index, never from the line count, so
      // removing lines cannot silently rewind the counter.
      this.totalAppended = records.length > 0 ? records[records.length - 1].index + 1 : 0;

      log.info('Cadena de auditoría restaurada desde disco', {
        records: records.length,
        loaded: this.chain.length,
        integrity: verdict.isValid
      });
    } catch (err) {
      log.error('No se pudo restaurar la cadena de auditoría; se inicia una nueva', { error: err.message });
      this.chain = [];
      this.startupIntegrity = { isValid: false, reason: `Archivo ilegible: ${err.message}` };
    }
  }

  /**
   * Verifies a contiguous run of records: every hash recomputes, every link
   * matches its predecessor, and the indices form an unbroken sequence that
   * starts at the genesis block.
   */
  _verifyRecords(records) {
    for (let i = 0; i < records.length; i++) {
      const current = records[i];

      // A gap in the numbering means records were removed from the middle.
      const expectedIndex = i === 0 ? current.index : records[i - 1].index + 1;
      if (current.index !== expectedIndex) {
        return {
          isValid: false,
          tamperedIndex: current.index,
          reason: `Salto en la numeración: se esperaba el bloque #${expectedIndex} y se encontró #${current.index}`
        };
      }

      const expectedPrev = i === 0 ? current.prevHash : records[i - 1].hash;
      if (current.prevHash !== expectedPrev) {
        return { isValid: false, tamperedIndex: current.index, reason: `Enlace roto en el bloque #${current.index}` };
      }

      if (current.hash !== this._digest(AuditChainLedger._canonical(current))) {
        return { isValid: false, tamperedIndex: current.index, reason: `Contenido alterado en el bloque #${current.index}` };
      }
    }

    if (records.length === 0) return { isValid: true, totalRecords: 0 };

    // The run must start at the genesis block. A first record numbered #5 means
    // the five that preceded it were deleted from the head of the file.
    if (records[0].index !== 0) {
      return {
        isValid: false,
        tamperedIndex: records[0].index,
        reason: `La cadena empieza en el bloque #${records[0].index}: faltan los ${records[0].index} registros iniciales`
      };
    }

    if (records[0].prevHash !== this.genesisHash) {
      return { isValid: false, tamperedIndex: 0, reason: 'El bloque génesis no enlaza con el hash inicial' };
    }

    return { isValid: true, totalRecords: records.length };
  }

  static _canonical(record) {
    return [
      record.index,
      record.timestamp,
      record.source,
      record.threatsCount,
      record.severity,
      record.categories,
      record.payloadHash,
      record.prevHash
    ].join('::');
  }

  _digest(canonical) {
    return this.hmacKey
      ? crypto.createHmac('sha256', this.hmacKey).update(canonical).digest('hex')
      : crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Appends an event. The caller passes an already-hashed payload reference —
   * the ledger never receives the sensitive text itself.
   */
  append(eventData = {}) {
    const previous = this.chain[this.chain.length - 1];
    const prevHash = previous ? previous.hash : this.genesisHash;

    const record = {
      index: previous ? previous.index + 1 : this.totalAppended,
      timestamp: eventData.timestamp || new Date().toISOString(),
      source: eventData.source || 'gateway',
      threatsCount: eventData.detectionsCount || 0,
      severity: eventData.severity || 'MEDIUM',
      categories: Array.isArray(eventData.items) ? eventData.items.map(i => i.name).join(';') : 'N/A',
      payloadHash: eventData.payloadHash || null,
      prevHash
    };

    record.hash = this._digest(AuditChainLedger._canonical(record));
    record.authenticated = Boolean(this.hmacKey);

    this.chain.push(record);
    this.totalAppended++;
    this._persist(record);

    if (this.chain.length > this.maxInMemory) this.chain.shift();

    return record;
  }

  _persist(record) {
    if (!this.filePath) return;
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (err) {
      log.error('Fallo al persistir el registro de auditoría', { error: err.message });
    }
  }

  /**
   * Verifies the chain. When it is backed by a file, the *whole file* is read
   * and recomputed, not just the records still held in memory — otherwise
   * anything older than `maxInMemory` could be rewritten undetected.
   * @returns {{isValid: boolean, totalBlocks: number, tamperedIndex?: number, reason?: string}}
   */
  verifyChainIntegrity() {
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const records = this._readAll();
        const verdict = this._verifyRecords(records);
        if (!verdict.isValid) return verdict;

        return {
          isValid: true,
          totalBlocks: this.chain.length,
          totalAppended: this.totalAppended,
          verifiedRecords: records.length,
          authenticated: Boolean(this.hmacKey),
          scope: this.hmacKey
            ? 'Integridad y autenticidad verificadas sobre el archivo completo.'
            : 'Integridad verificada sobre el archivo completo. Sin clave HMAC, un atacante con acceso al proceso puede recalcular la cadena entera.'
        };
      } catch (err) {
        return { isValid: false, reason: `No se pudo leer el archivo de auditoría: ${err.message}` };
      }
    }

    const verdict = this._verifyRecords(this.chain);
    if (!verdict.isValid) return verdict;

    return {
      isValid: true,
      totalBlocks: this.chain.length,
      totalAppended: this.totalAppended,
      authenticated: Boolean(this.hmacKey),
      // Named so nobody reads "verified" as a stronger claim than it is.
      scope: this.hmacKey
        ? 'Integridad y autenticidad verificadas sobre la ventana en memoria.'
        : 'Integridad verificada sobre la ventana en memoria. Sin clave HMAC, un atacante con acceso al proceso puede recalcular la cadena.'
    };
  }

  /** JSON Lines, one record per line — the format most SIEMs ingest directly. */
  exportJSONL() {
    return this.chain.map(entry => JSON.stringify(entry)).join('\n');
  }

  /** RFC 4180 CSV for spreadsheet-based compliance review. */
  exportCSV() {
    const columns = ['index', 'timestamp', 'source', 'severity', 'threatsCount', 'categories', 'payloadHash', 'prevHash', 'hash', 'authenticated'];
    const escape = value => {
      const str = value === null || value === undefined ? '' : String(value);
      return /[",\n\r]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
    };

    const rows = this.chain.map(entry => columns.map(col => escape(entry[col])).join(','));
    return [columns.join(','), ...rows].join('\n');
  }

  getEntries() {
    return this.chain;
  }
}

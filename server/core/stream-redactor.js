/**
 * Applies DLP redaction to a token stream.
 *
 * Streaming and egress redaction are in tension: once a chunk is on the wire it
 * cannot be taken back, but a secret can straddle a chunk boundary.
 *
 * The first implementation held a fixed tail and scanned only the part it was
 * about to release. That does not work, and it failed silently: a secret that
 * *started* in the released part and continued into the tail was never present
 * in any single scanned string, so nothing matched and the prefix went out in
 * the clear. Measured with a 96-character tail, an OpenAI key, a database
 * connection string and a PEM block all leaked.
 *
 * This version does two things instead:
 *
 *  1. It scans the **whole** buffer on every push, so a match spanning the
 *     release boundary is found.
 *  2. It holds back from the last unterminated *opener* — the prefix that
 *     begins a secret whose length is not bounded, like `-----BEGIN` or `eyJ`.
 *     Without this, no fixed tail size can ever be large enough: a PEM block
 *     runs to hundreds of characters.
 *
 * The cost is latency and memory, both bounded by `maxHoldChars`. When that
 * bound is hit the text is released and `truncatedHold` is set, so the caller
 * knows redaction may be incomplete rather than assuming it succeeded.
 */

/**
 * Prefixes that can begin a secret whose end is not yet known. Matching one of
 * these near the end of the buffer means "more may be coming — do not release".
 */
const OPENERS = /-----BEGIN|sk-|sk_|rk_|pk_|xox[baprs]-|gh[pousr]_|github_pat_|glpat-|AKIA|AIza|eyJ|AccountKey=|postgres|mysql|mongodb|redis:\/\/|amqp:\/\//gi;

export class StreamRedactor {
  /**
   * @param {import('../dlp-engine.js').DLPEngine} dlp
   * @param {Object} options
   * @param {number} options.tailSize     Characters always withheld.
   * @param {number} options.maxHoldChars Upper bound on what an opener may hold.
   */
  constructor(dlp, { tailSize = 256, maxHoldChars = 64 * 1024 } = {}) {
    this.dlp = dlp;
    this.tailSize = tailSize;
    this.maxHoldChars = maxHoldChars;
    this.buffer = '';
    this.detections = [];
    this.truncatedHold = false;
    this._seenHashes = new Set();
  }

  /**
   * Feeds a chunk in and returns the text that is safe to emit now.
   * @returns {string}
   */
  push(chunk) {
    this.buffer += chunk;
    if (this.buffer.length <= this.tailSize) return '';

    // Scan the entire buffer, not just the part about to be released.
    const scanned = this._scan(this.buffer);

    let releaseUpTo = scanned.length - this.tailSize;
    if (releaseUpTo <= 0) {
      this.buffer = scanned;
      return '';
    }

    // Hold from an opener that has not resolved into a detection yet.
    const openerAt = StreamRedactor._lastOpenerIndex(scanned);
    if (openerAt !== -1 && openerAt < releaseUpTo) {
      const wouldHold = scanned.length - openerAt;
      if (wouldHold <= this.maxHoldChars) {
        releaseUpTo = openerAt;
      } else {
        // Bounded: an opener in ordinary prose must not pin memory forever.
        this.truncatedHold = true;
      }
    }

    if (releaseUpTo <= 0) {
      this.buffer = scanned;
      return '';
    }

    const released = scanned.slice(0, releaseUpTo);
    this.buffer = scanned.slice(releaseUpTo);
    return released;
  }

  /** Flushes whatever is still held back. Always call before ending the stream. */
  flush() {
    if (!this.buffer) return '';
    const remaining = this._scan(this.buffer);
    this.buffer = '';
    return remaining;
  }

  /** Index of the last opener, or -1. Placeholders contain no openers. */
  static _lastOpenerIndex(text) {
    OPENERS.lastIndex = 0;
    let last = -1;
    let match;
    while ((match = OPENERS.exec(text)) !== null) last = match.index;
    return last;
  }

  /**
   * Scans and masks. Detections are deduplicated by value hash, because the
   * same buffer is rescanned on every chunk and a single leaked key would
   * otherwise be counted — and audited — once per chunk.
   */
  _scan(text) {
    const result = this.dlp.process(text, 'LLM egress (stream)', { audit: false });

    for (const detection of result.detections) {
      if (this._seenHashes.has(detection.valueHash)) continue;
      this._seenHashes.add(detection.valueHash);
      this.detections.push(detection);
    }

    return result.sanitizedText;
  }

  get wasMasked() {
    return this.detections.length > 0;
  }
}

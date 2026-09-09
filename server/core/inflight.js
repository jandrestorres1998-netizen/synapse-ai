/**
 * In-flight request coalescing.
 *
 * A cache only helps once the first answer has been stored. Fifty identical
 * requests arriving together all miss, all call the provider, and the operator
 * pays fifty times for one answer — the classic cache stampede, and it is most
 * likely exactly when it hurts most: a deploy, a retry storm, a page that fans
 * out the same prompt.
 *
 * Callers with the same key share the first call's promise. Only non-streaming
 * requests are coalesced: a stream has a single consumer of its body, so
 * sharing it between clients would need buffering the whole answer and would
 * defeat the point of streaming.
 */
export class InFlightRegistry {
  constructor() {
    /** @type {Map<string, Promise>} */
    this.pending = new Map();
    this.stats = { coalesced: 0, started: 0 };
  }

  /**
   * @param {string} key
   * @param {() => Promise<any>} factory
   */
  async run(key, factory) {
    const existing = this.pending.get(key);
    if (existing) {
      this.stats.coalesced++;
      // A rejection propagates to every waiter, which is correct: they would
      // all have hit the same failing upstream.
      return existing;
    }

    this.stats.started++;
    const promise = (async () => factory())().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);

    return promise;
  }

  get size() {
    return this.pending.size;
  }
}

import { createLogger } from '../config/logger.js';

const log = createLogger('CRDTCache');

/**
 * SynapseAI LWW-CRDT (Last-Write-Wins Map)
 * A state-based Conflict-Free Replicated Data Type.
 * Guarantees mathematical eventual consistency across the P2P swarm.
 * Operations are commutative, associative, and idempotent.
 */
export class LwwCrdtCache {
  constructor(nodeId) {
    this.nodeId = nodeId;
    // The state maps a key to { value, timestamp, peerId }
    this.state = new Map();
  }

  /**
   * Generates a logical timestamp (fallback to Date.now() for simplicity in this implementation)
   */
  _getTimestamp() {
    return Date.now();
  }

  /**
   * Sets a value in the local CRDT state.
   */
  set(key, value) {
    const timestamp = this._getTimestamp();
    this.state.set(key, { value, timestamp, peerId: this.nodeId });
    log.debug(`CRDT Set Local: ${key} at ${timestamp}`);
    return { key, value, timestamp, peerId: this.nodeId };
  }

  /**
   * Retrieves a value from the CRDT state.
   */
  get(key) {
    const record = this.state.get(key);
    return record ? record.value : null;
  }

  /**
   * Merges a remote CRDT state into the local state.
   * Mathematical Guarantee: merge(A, B) === merge(B, A)
   * 
   * @param {Object} remoteState - A serialized map or array of entries
   */
  merge(remoteState) {
    let mergedCount = 0;
    
    // remoteState can be an array of [key, {value, timestamp, peerId}]
    for (const [key, remoteRecord] of remoteState) {
      const localRecord = this.state.get(key);

      // Conflict Resolution Rule (Last-Write-Wins)
      if (!localRecord || remoteRecord.timestamp > localRecord.timestamp) {
        this.state.set(key, remoteRecord);
        mergedCount++;
      } else if (remoteRecord.timestamp === localRecord.timestamp) {
        // Tie-breaker: Lexicographical comparison of PeerIds ensures determinism
        if (remoteRecord.peerId > localRecord.peerId) {
          this.state.set(key, remoteRecord);
          mergedCount++;
        }
      }
    }

    if (mergedCount > 0) {
      log.info(`CRDT Merge completed: ${mergedCount} keys updated.`);
    }
  }

  /**
   * Exports the CRDT state for network broadcast (Gossipsub).
   */
  exportState() {
    return Array.from(this.state.entries());
  }

  getStateSize() {
    return this.state.size;
  }
}

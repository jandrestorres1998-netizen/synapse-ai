import { createLogger } from '../config/logger.js';
import { LwwCrdtCache } from './crdt-cache.js';
import { PeerTrustEngine } from './peer-trust.js';

const log = createLogger('SyncEngine');

/**
 * SynapseAI P2P Sync Engine
 * Orchestrates the flow of data between the CRDT Memory and the network layer (Gossipsub).
 * Ensures that untrusted data is mathematically validated and sanitized before merging.
 */
export class SyncEngine {
  constructor(nodeId) {
    this.crdt = new LwwCrdtCache(nodeId);
    this.trust = new PeerTrustEngine();
  }

  /**
   * Processes an incoming Gossipsub message from a remote peer.
   * @param {string} peerId - The Ed25519 PeerId authenticated by libp2p.
   * @param {Array} remoteState - The serialized CRDT delta.
   */
  ingestRemoteState(peerId, remoteState) {
    if (this.trust.isBanned(peerId)) {
      log.warn(`Ignorando mensaje de Peer Banneado: ${peerId}`);
      return false;
    }

    if (!Array.isArray(remoteState)) {
      log.error(`Estado remoto malformado recibido de ${peerId}`);
      return false;
    }

    // 1. Sanitize & Filter: Validate every entry proposed by the peer
    const safeState = [];
    for (const [key, payload] of remoteState) {
      if (this.trust.validateCacheProposal(peerId, payload)) {
        // Enforce that the peer is not trying to spoof another peer's identity in the CRDT
        if (payload.peerId !== peerId) {
           log.warn(`Spoofing detectado. Peer ${peerId} intentó enviar datos a nombre de ${payload.peerId}`);
           continue; // Drop the spoofed entry
        }
        safeState.push([key, payload]);
      } else {
        // If one entry is toxic, the trust engine penalizes the peer. 
        // We can either drop the toxic entry or the whole payload. Dropping toxic is safer.
      }
    }

    // 2. Mathematical Merge (Commutative & Idempotent)
    if (safeState.length > 0) {
      this.crdt.merge(safeState);
      return true;
    }

    return false;
  }

  /**
   * Intercepts local cache writes and adds them to the CRDT.
   * Returns the delta to be broadcasted over Gossipsub.
   */
  addLocalEntry(key, value) {
    const record = this.crdt.set(key, value);
    // Return a format suitable for broadcast
    return [ [key, record] ]; 
  }

  getLocalCacheValue(key) {
    return this.crdt.get(key);
  }
}

import { createLogger } from '../config/logger.js';

const log = createLogger('PeerTrust');

/**
 * SynapseAI Zero-Trust P2P (Application Layer)
 * Validates incoming Gossipsub messages after libp2p has verified their Ed25519 signatures.
 * Responsible for cache poisoning prevention and peer scoring decisions.
 */
export class PeerTrustEngine {
  constructor() {
    // Local reputation tracking before escalating to libp2p banning
    this.peerScores = new Map();
  }

  /**
   * Validates a cache block proposed by a remote peer before merging into the CRDT.
   * @param {string} peerId - The Ed25519 PeerId (authenticated by libp2p Gossipsub)
   * @param {Object} payload - The cache entry { key, value }
   */
  validateCacheProposal(peerId, payload) {
    // 1. Structural Sanity Check
    if (!payload || !payload.value || !payload.timestamp) {
      log.warn(`Invalid cache structure from ${peerId}`);
      this._penalize(peerId, 10);
      return false;
    }

    const valueStr = typeof payload.value === 'string' ? payload.value : JSON.stringify(payload.value);

    // 2. Semantic Poisoning Detection (Anti-Malware / Anti-Injection in Cache)
    const poisonSignatures = [
      /<script\b[^>]*>([\s\S]*?)<\/script>/i, // XSS injection attempt
      /\b(rm -rf|drop table|truncate table|delete from)\b/i, // Destructive commands
      /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/ // PII/Email exfiltration trap
    ];

    for (const sig of poisonSignatures) {
      if (sig.test(valueStr)) {
        log.error(`🚨 CACHE POISONING ATTEMPT DETECTED 🚨`, {
          peerId,
          signature: sig.toString()
        });
        
        // Immediate ban signal
        this._penalize(peerId, 100);
        return false;
      }
    }

    // 3. Threshold Consensus (Future enhancement: Compare with local model if suspicious)
    
    return true; // Trust verified
  }

  _penalize(peerId, points) {
    const currentScore = this.peerScores.get(peerId) || 0;
    const newScore = currentScore + points;
    this.peerScores.set(peerId, newScore);

    if (newScore >= 100) {
      log.warn(`🛑 PEER BANNED: ${peerId} exceeded toxicity threshold.`);
      // In a full implementation, this triggers libp2p.components.peerStore.addressBook.delete(peerId)
      // and pubsub.banPeer(peerId)
    }
  }

  isBanned(peerId) {
    return (this.peerScores.get(peerId) || 0) >= 100;
  }
}

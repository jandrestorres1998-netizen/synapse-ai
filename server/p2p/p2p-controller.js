import { createP2PNode } from './network-node.js';
import { SyncEngine } from './sync-engine.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('P2PController');
const CRDT_TOPIC = 'synapse/crdt/v1';

/**
 * SynapseAI P2P Mesh Controller
 * Wires the Gossipsub network events to the Zero-Trust CRDT Sync Engine.
 */
export class P2PController {
  constructor() {
    this.node = null;
    this.syncEngine = null;
  }

  async start() {
    // 1. Start libp2p network node
    this.node = await createP2PNode();
    await this.node.start();
    
    const peerId = this.node.peerId.toString();
    log.info(`P2P Node Iniciado. PeerID: ${peerId}`);

    // 2. Initialize CRDT Sync Engine for this Peer
    this.syncEngine = new SyncEngine(peerId);

    // 3. Subscribe to Epidemic Gossipsub Topic
    this.node.services.pubsub.subscribe(CRDT_TOPIC);
    log.info(`Suscrito a la malla de enrutamiento epidémico: ${CRDT_TOPIC}`);

    // 4. Wire Gossipsub messages to the SyncEngine
    this.node.services.pubsub.addEventListener('message', (evt) => {
      const { topic, data, from } = evt.detail;
      if (topic !== CRDT_TOPIC) return;

      const senderId = from.toString();
      
      // Ignore echo (messages we sent ourselves)
      if (senderId === peerId) return;

      try {
        const payloadStr = new TextDecoder().decode(data);
        const remoteState = JSON.parse(payloadStr);

        // Route to the Zero-Trust CRDT Merge pipeline
        const success = this.syncEngine.ingestRemoteState(senderId, remoteState);
        
        if (success) {
          log.debug(`Estado CRDT remoto integrado exitosamente desde ${senderId}`);
        }
      } catch (err) {
        log.error(`Fallo al deserializar mensaje P2P de ${senderId}`, err.message);
      }
    });
  }

  /**
   * Broadcasts a local CRDT delta to the Gossipsub mesh.
   */
  async broadcastDelta(key, value) {
    if (!this.node || !this.syncEngine) {
      log.warn('La red P2P no está inicializada. Guardando solo localmente.');
      return false;
    }

    // 1. Add to local CRDT first
    const delta = this.syncEngine.addLocalEntry(key, value);

    // 2. Broadcast delta to the Swarm
    try {
      const encodedPayload = new TextEncoder().encode(JSON.stringify(delta));
      await this.node.services.pubsub.publish(CRDT_TOPIC, encodedPayload);
      log.info(`Delta Epidémico transmitido a la malla: ${key}`);
      return true;
    } catch (err) {
      log.error(`Fallo al propagar Delta CRDT por Gossipsub`, err.message);
      return false;
    }
  }

  async stop() {
    if (this.node) {
      await this.node.stop();
      log.info('Nodo P2P detenido de manera grácil.');
    }
  }
}

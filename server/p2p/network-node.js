import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { mdns } from '@libp2p/mdns';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@libp2p/yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { createLogger } from '../config/logger.js';

const log = createLogger('P2PNode');

/**
 * Creates and initializes a libp2p node tailored for SynapseAI.
 * Transports: TCP (Backend) + WebSockets (Edge).
 * Discovery: mDNS (LAN Zero-Configuration).
 * PubSub: Gossipsub.
 * Encryption: Noise_XX (Perfect Forward Secrecy).
 */
export async function createP2PNode() {
  log.info('Inicializando nodo P2P (libp2p)...');

  const node = await createLibp2p({
    addresses: {
      // Escuchar en interfaces locales y LAN (Puerto dinámico para TCP y WS)
      listen: [
        '/ip4/127.0.0.1/tcp/0',
        '/ip4/127.0.0.1/tcp/0/ws'
      ]
    },
    transports: [
      tcp(),
      webSockets()
      // WebRTC Stub: Se excluye @libp2p/webrtc deliberadamente para evitar fricción C++ 
      // en el despliegue del servidor Node.js, como acordado en la arquitectura.
    ],
    connectionEncrypters: [
      noise() // Cifrado P2P extremo a extremo
    ],
    streamMuxers: [
      yamux()
    ],
    peerDiscovery: [
      mdns({
        interval: 1000,
        // Tag corporativo para aislar la malla en la LAN
        serviceTag: 'synapse-ai-node.local' 
      })
    ],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        emitSelf: false,
        fallbackToFloodsub: false,
        // Configuración paramétrica de la malla
        scoreParams: {
          IPColocationFactorWeight: 0, // Permitimos múltiples nodos en 1 IP (para testing/oficinas)
        },
        // Prevención de Tormentas
        D: 6,
        Dlo: 4,
        Dhi: 12
      })
    }
  });

  // Event Listeners de Diagnóstico
  node.addEventListener('peer:discovery', (evt) => {
    const peerId = evt.detail.id.toString();
    log.debug(`[mDNS] Nuevo par descubierto: ${peerId}`);
  });

  node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail.toString();
    log.info(`[Conexión TCP/WS] Par conectado: ${peerId}`);
  });

  node.addEventListener('peer:disconnect', (evt) => {
    const peerId = evt.detail.toString();
    log.warn(`[Desconexión] Par desconectado: ${peerId}`);
  });

  return node;
}

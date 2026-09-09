> **⚠ Documento heredado — anterior a la auditoría de septiembre de 2026.**
> Se conserva como registro histórico. Contiene afirmaciones que la auditoría
> demostró falsas o sin respaldo (pruebas de conocimiento cero que eran
> constantes escritas a mano, cifras de ahorro derivadas de una comparación
> amañada, pruebas que siempre pasaban). No lo uses como descripción del sistema
> ni como material comercial.
> Lee [`AUDIT_2026.md`](AUDIT_2026.md) y el [README](../README.md) actual.

# SynapseAI Knowledge Base & Architecture Manifesto

## 1. Zero-Trust P2P Architecture (Scale Vertical)
### 1.1 Transporte Multicapa (TCP y WebSockets)
- **TCP (`@libp2p/tcp`)**: Backbone para entornos Node.js/Backend. Permite alto throughput, esencial para transferir pesos de modelos y sincronizar grandes grafos CRDT.
- **WebSockets (`@libp2p/websockets`)**: Puente para nodos ligeros perimetrales y navegadores web. Atraviesa firewalls HTTP/HTTPS y permite redes híbridas.

### 1.2 Descubrimiento Local Autónomo (mDNS)
- **`@libp2p/mdns`**: Permite topologías "Zero-Configuration" en LAN corporativas (puerto 5353, multicast IPv4 224.0.0.251). Los nodos se descubren en milisegundos sin depender de DNS centralizado ni salida WAN, asegurando continuidad operativa incluso ante cortes de internet.

### 1.3 Enrutamiento Epidémico (Gossipsub)
- **`@chainsafe/libp2p-gossipsub` (v14+)**: Previene tormentas de red mediante mallas paramétricas (ej. D=6, Dlow=4, Dhigh=12). Emplea mensajes ligeros `IHave`/`IWant` para solicitar cargas útiles faltantes y cuenta con un **Peer Scoring** intrínseco que penaliza a nodos ineficientes o maliciosos, aislando vectores Sybil.

### 1.4 Privacidad en Tránsito (Protocolo Noise)
- **`@chainsafe/libp2p-noise`**: Cifrado P2P extremo a extremo mediante el patrón `Noise_XX` y acuerdos Diffie-Hellman efímeros (Curve25519). Garantiza Perfect Forward Secrecy y ofuscación del `PeerId` frente a escuchas locales o ISPs.

### 1.5 Estrategia WebRTC (NAT Traversal en Node.js)
- En Node.js, WebRTC requiere librerías C++ pesadas (`wrtc`) que quiebran pipelines CI/CD y causan segmentation faults en Alpine Linux. 
- **Decisión Arquitectónica**: Implementar "Stubs" pasivos de WebRTC en el servidor Node.js. Los clientes web usarán WebSockets para conectar con los servidores relé TCP. Esto elimina el peso de compilación de C++ del lado del servidor.

### 1.6 Sincronización Matemática de Estado (LWW-CRDT)
- **State Tuple**: $S = (V, T, P)$, donde $V$ es el valor, $T$ el Reloj Lógico Híbrido, y $P$ el identificador criptográfico asimétrico del autor. 
- La fusión (`merge`) resuelve colisiones garantizando que $T_1 > T_2$ gane, y en caso de empate $T_1 = T_2$, gana el mayor lexicográficamente $P_1 > P_2$. Esto garantiza **Strong Eventual Consistency (SEC)** sin bloqueos ni pérdida de disponibilidad (Teorema CAP).

## 2. Auditoría Zero-Knowledge (Privacy Vertical)
- **zk-SNARKs**: Se integran para validar pruebas computacionales pesadas (ej. validación OCR multimodal con VLMs) sobre el bus P2P, garantizando la inmutabilidad analítica sin revelar PII.

## 3. Go-To-Market & Cumplimiento Normativo B2B (Colombia)
- **Desafío Hábeas Data (Ley 1581)**: El flujo P2P descontrolado infringe normativas de retención. Solucionado mediante **Payload Encryption** (AES-GCM/KMS) antes de inyectar en Gossipsub.
- **Confinamiento (Sub-meshing)**: Uso estricto de mDNS para formar enjambres On-Premises aislados geográficamente.
- **SFC Sandbox**: Vehículo principal de penetración para Fintechs colombianas, apoyándose en zk-SNARKs para auditorías compliance transparentes y Onboarding automatizado sin exponer datos biométricos o financieros en plano.

## 4. Prevención de Pérdida de Datos Perimetral (Edge DLP)
- **Zero-Trust Endpoint**: Antes de que la imagen sea procesada por la red P2P, un motor WASM intercepta la imagen en la memoria volátil del navegador.
- **Inferencia Tensorial (onnxruntime-web)**: Extracción local de texto y coordenadas (Bounding Boxes) utilizando Modelos de Visión y Lenguaje (VLM).
- **Validación Algorítmica**: Filtrado semántico rápido. Por ejemplo, se utiliza el Algoritmo de Luhn sobre strings extraídos para certificar matemáticamente si un número constituye una tarjeta de crédito válida.
- **Redacción Espacial Determinista ($O(N)$)**: En lugar de usar la API `Canvas2D` (la cual es susceptible a Canvas Fingerprinting e inconsistencias de anti-aliasing entre navegadores), la redacción (Censura/Blurring) de la PII se realiza manipulando matrices `Uint8ClampedArray` puras. El uso de **Separable Box Blur** asegura que el hash criptográfico del buffer saliente sea 100% idéntico y determinista en cualquier hardware, crucial para el consenso CRDT.

# Módulos experimentales

Estos directorios contienen prototipos que **no están conectados al servidor**.
No se cargan al arrancar, sus dependencias no se instalan por defecto y no
existen pruebas que los cubran. Se conservan porque contienen trabajo
aprovechable, no porque estén listos.

Si algo de aquí aparece en material de marketing, es una afirmación sin
respaldo.

## `server/p2p/`

Malla libp2p con un CRDT last-write-wins para compartir caché entre nodos, más
un motor de reputación de pares. El código está razonablemente escrito, pero:

- Nunca se instancia desde `server/`.
- Requiere `libp2p` y seis paquetes `@libp2p/*` que ya no se declaran como
  dependencias.
- El descubrimiento por mDNS asume una LAN de confianza.
- Compartir caché entre nodos significa compartir respuestas entre inquilinos:
  el aislamiento por inquilino que aplica `ResponseCache` no existe en el CRDT.

Para activarlo haría falta resolver primero ese último punto.

## `server/security/ast-sandbox.js` y `agent-schemas.js`

Validación de llamadas a herramientas de un agente: esquema JSON estricto con
Ajv, más análisis del AST de SQL y Bash para rechazar operaciones destructivas.
Requiere `ajv`, `node-sql-parser` y `bash-parser`, declaradas como dependencias
opcionales. Ninguna ruta del gateway invoca este módulo, porque el gateway no
ejecuta herramientas de agente todavía.

## `circuits/`, `client/zk/`

Circuito Circom y un prover en el cliente para pruebas de conocimiento cero
sobre eventos DLP.

**La implementación que existía en el servidor era falsa.** `zk-prover.js`
devolvía constantes escritas a mano (`pi_a: ["1987391827391...", …]`) y un
`setTimeout` de 200 ms que el comentario describía como «operaciones de curva
elíptica». El verificador comprobaba un hash propio, no una prueba. El sistema
presentaba eso como auditabilidad Groth16 verificable.

Ese código se ha retirado. El circuito `DlpAudit.circom` sigue aquí como punto de
partida si alguna vez se implementa de verdad, lo que exigiría compilarlo,
generar la ceremonia de setup y usar snarkjs con `.wasm` y `.zkey` reales.

## `client/frontend/`

Segunda interfaz en React/Vite que duplica el panel de `public/`. No la sirve el
servidor, apunta a formas de API que ya no existen y su cabecera afirma
«100% Real API integration - Zero mock, zero simulations, zero hardcoded
replies» sobre un backend que en ese momento devolvía respuestas fabricadas.

Elige una interfaz y borra la otra. La que está viva es `public/`.

## `client/dlp/`

Redactor espacial y motor OCR en WASM para censurar PII en imágenes. Aislado del
resto y sin integrar en ningún flujo.

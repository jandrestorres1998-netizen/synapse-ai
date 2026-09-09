# Módulos experimentales retirados

En septiembre de 2026 se eliminaron del árbol 1.587 líneas repartidas en doce
módulos que **ningún camino de ejecución del servidor invocaba**. Estaban ahí,
había que leerlos al navegar el código, aparecían en la lista de integridad y
alguno se citaba en material comercial como si fuese funcionalidad.

Siguen en el historial de git. Para recuperar cualquiera de ellos:

```bash
git log --oneline --diff-filter=D -- server/p2p
git checkout <commit>^ -- server/p2p
```

## Qué se retiró y por qué

| Módulo | Motivo |
| :-- | :-- |
| `server/p2p/` (5 archivos) | Malla libp2p con un CRDT last-write-wins para compartir caché entre nodos. Nunca se instanciaba desde el servidor, requería siete paquetes que ya no se declaran, y compartir caché entre nodos habría anulado el aislamiento por inquilino que `ResponseCache` sí aplica. |
| `server/security/zk-prover.js`, `zk-verifier.js` | **La implementación era falsa.** Devolvía constantes escritas a mano (`pi_a: ["1987391827391...", …]`) y un `setTimeout` de 200 ms que el comentario describía como «operaciones de curva elíptica». El verificador comprobaba un hash propio, no una prueba. El sistema lo presentaba como auditabilidad Groth16. |
| `circuits/DlpAudit.circom`, `client/zk/` | Circuito y prover de cliente para lo anterior. Sin la ceremonia de setup ni snarkjs con `.wasm` y `.zkey` reales, no eran nada. |
| `server/security/ast-sandbox.js`, `agent-schemas.js` | Validación de llamadas a herramientas de un agente. Razonablemente escrito, pero el gateway no ejecuta herramientas de agente, así que nada lo llamaba. |
| `server/core/hardware-telemetry.js` | Ejecutaba `wmic` de forma síncrona en el camino de la petición. `wmic` está retirado en Windows 11. Dejó de usarse al reescribir el enrutado. |
| `server/core/kv-cache-math.js` | Cálculo de VRAM para decidir si un modelo cabía en local. Dependía del anterior. |
| `server/tls-shield.js` | Fijado de certificados con huellas SPKI **inventadas**, y ninguna ruta de ejecución lo invocaba nunca. |
| `client/dlp/` | Redactor espacial y OCR en WASM para censurar PII en imágenes. Aislado, sin integrar en ningún flujo. |

## Lo que queda pendiente de decidir

`client/frontend/` sigue en el disco pero **fuera de este repositorio**: tiene su
propio historial git, así que añadirlo aquí lo habría convertido en un submódulo
apuntando a ninguna parte. Es un segundo panel en React que el servidor no
sirve, que apunta a formas de API anteriores a la reescritura y cuya cabecera
afirma «100% Real API integration - Zero mock» sobre un backend que entonces
fabricaba las respuestas.

Elige una interfaz y borra la otra. La que está viva es `public/`.

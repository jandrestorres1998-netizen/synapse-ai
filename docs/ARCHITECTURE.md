# Arquitectura

## Qué es

Un proceso Node/Express que se sitúa entre las aplicaciones de una organización
y los proveedores de LLM. Todo el tráfico pasa por un único pipeline, y ese punto
de paso es lo que permite aplicar redacción, filtrado, enrutado, caché y
auditoría de forma uniforme.

```
Cliente (SDK OpenAI · panel · extensión)
   │  Authorization: Bearer <SYNAPSE_API_KEY>
   ▼
┌─────────────────────────────────────────────────────────────┐
│ server/server.js                                            │
│   cabeceras de seguridad → CORS (lista blanca) → auth →     │
│   límite de tasa → validación                               │
└─────────────────────────────────────────────────────────────┘
   ▼
┌─────────────────────────────────────────────────────────────┐
│ server/core/pipeline.js                                     │
│                                                             │
│  1. Filtro de inyección   sobre el texto SIN tocar          │
│  2. DLP de entrada        sobre TODOS los mensajes          │
│  3. Contexto de sistema   directrices activas + canario     │
│  4. Caché                 clave = inquilino+modelo+contexto │
│  5. Enrutado              solo a proveedores alcanzables    │
│  6. Llamada real          + failover si el error es           │
│                           reintentable                       │
│  7. DLP de salida         + verificación del canario         │
│  8. Persistencia          caché · telemetría · auditoría     │
└─────────────────────────────────────────────────────────────┘
   ▼
OpenAI · Anthropic · Google · Ollama
```

## Por qué ese orden

**El filtro de inyección va primero, sobre el texto original.** Si se enmascarara
antes, la redacción podría destruir justamente los tokens que el filtro busca.

**El DLP va antes que la caché.** La clave de caché se calcula sobre el texto ya
redactado, de modo que un secreto nunca llega a formar parte de una consulta de
caché ni queda derivado en una clave.

**La caché va antes que el enrutado a un proveedor**, pero su clave incluye el
modelo. Un acierto solo sirve la respuesta que se generó con ese mismo modelo,
para ese mismo inquilino y bajo el mismo contexto de sistema. Cambiar cualquiera
de los tres invalida la entrada: servir una respuesta generada bajo una política
anterior es un fallo de corrección, no una optimización.

**El DLP de salida existe** porque el modelo puede devolver un secreto —estaba en
su contexto, o lo alucinó con formato válido—. En streaming se aplica con un
buffer de cola: el texto no se libera hasta que han llegado suficientes
caracteres posteriores como para que ningún patrón pueda extenderse dentro. Eso
cuesta latencia, y es la contrapartida explícita de poder redactar un stream.

## Módulos

| Ruta | Responsabilidad |
| :-- | :-- |
| `config/env.js` | Carga y **valida** el entorno. Aborta el arranque ante combinaciones inseguras en producción. |
| `config/container.js` | Raíz de composición. Único lugar donde se instancian los servicios. |
| `config/models.json` | Catálogo de modelos y precios. Parámetro del operador, no dato verificado. |
| `core/pipeline.js` | Orquestación descrita arriba. Sin lógica HTTP. |
| `core/response-cache.js` | Caché con aislamiento por ámbito. Exacta por defecto; similitud opcional. |
| `core/stream-redactor.js` | Redacción sobre streams con buffer de cola. |
| `core/telemetry.js` | Contadores derivados solo de eventos medidos. |
| `providers/` | Un adaptador por proveedor. Normaliza petición y respuesta; nada más. |
| `dlp-engine.js` | Patrones y checksums. Registra hashes, no texto. |
| `smart-router.js` | Clasifica y selecciona entre modelos alcanzables. Calcula coste sobre uso reportado. |
| `security/audit-chain.js` | Cadena de hashes persistida en JSONL, con HMAC opcional. |
| `secure-vault.js` | AES-256-GCM para credenciales de proveedor. |
| `store/json-store.js` | Persistencia con escritura atómica para las directrices. |

## Decisiones y sus límites

**Un proceso, un nodo.** La caché vive en memoria y el estado en archivos JSON.
Dos réplicas detrás de un balanceador divergen: cada una tendría su caché y sus
directrices. Escalar exige un almacén compartido (Redis para la caché, Postgres
para el estado) y es trabajo pendiente, no configuración.

**Sin fallback sintético.** Si no hay proveedor configurado, la petición devuelve
503. La versión anterior devolvía texto fabricado con plantillas, indistinguible
de una respuesta del modelo. Un gateway que miente sobre el origen de una
respuesta es peor que uno que falla.

**Compatibilidad OpenAI parcial.** Se implementa `POST /v1/chat/completions` con
y sin streaming. **No** hay todavía `tool_calls`/function calling, contenido
multimodal, `response_format`, `logprobs`, `n>1` ni embeddings. Una aplicación
agéntica no puede limitarse a cambiar el `baseURL`. Está documentado aquí porque
la promesa de compatibilidad total, sin esta lista al lado, sería falsa.

**El coste es una medición, la comparación es una comparación.** `cost.usd` sale
del uso reportado por el proveedor y se marca `isEstimate` cuando este no lo
reporta. `comparison.deltaUsd` responde a «qué habría costado en el modelo de
referencia» y lleva una nota que impide leerlo como dinero ahorrado.

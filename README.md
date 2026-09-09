# SynapseAI Gateway

Gateway auto-alojado para tráfico de LLM. Se coloca entre tus aplicaciones y los
proveedores de modelos, y en ese punto aplica redacción de datos sensibles,
filtrado de inyección de prompts, enrutamiento por coste, caché de respuestas y
un registro de auditoría encadenado.

Habla el protocolo de OpenAI, así que integrarlo es cambiar el `baseURL` de tu
cliente actual.

---

## Qué hace, exactamente

| Capacidad | Qué hace de verdad | Qué **no** hace |
| :-- | :-- | :-- |
| **Redacción DLP** | Detecta y enmascara secretos estructurados antes de que el texto salga hacia el proveedor, y escanea también la respuesta del modelo. Cubre claves de API (OpenAI, Anthropic, Google, AWS, GitHub, GitLab, Slack, Stripe), bloques PEM, JWT, cadenas de conexión, tarjetas (Luhn) e **identificadores iberoamericanos con checksum real**: DNI/NIE, CIF, RFC, CURP, CPF, CNPJ e IBAN. | No entiende información confidencial en prosa. Una estrategia comercial escrita en párrafos pasa intacta. Ningún motor de expresiones regulares resuelve eso. |
| **Filtro de inyección** | Bloquea patrones conocidos de sobreescritura de instrucciones y exfiltración del prompt de sistema. | No es un clasificador semántico. Una reformulación creativa lo atraviesa. Reduce el ruido, no cierra la clase de ataque. |
| **Enrutado por coste** | Clasifica la petición y la envía al nivel de modelo adecuado entre los proveedores que **realmente** tienes configurados, con degradación y failover. | No adivina qué modelo da mejor calidad para tu dominio. La clasificación es por patrones, no por evaluación. |
| **Caché de respuestas** | Coincidencia exacta con aislamiento por inquilino, modelo y contexto de sistema. Opcionalmente, coincidencia por similitud. | La tasa de aciertos depende de que tu tráfico se repita. Con prompts mayoritariamente únicos, es cercana a cero. |
| **Auditoría encadenada** | Cadena de hashes persistida en JSONL, con HMAC opcional. Exporta a JSONL y CSV para SIEM. | No es a prueba de un atacante que controle el proceso mientras se escribe. Para eso hay que enviar el registro fuera de la máquina auditada. |
| **Vault de credenciales** | AES-256-GCM con clave maestra desde `SYNAPSE_VAULT_KEY`. | En modo `machine` (sin esa variable) la clave se deriva de datos públicos del equipo: es ofuscación, no cifrado frente a un atacante local. El sistema lo avisa en cada arranque. |

---

## Inicio rápido

```bash
npm install
cp .env.example .env
```

Edita `.env` y define al menos:

```bash
SYNAPSE_API_KEYS=$(openssl rand -hex 32)
SYNAPSE_VAULT_KEY=$(openssl rand -hex 32)
OPENAI_API_KEY=sk-...          # o ANTHROPIC_API_KEY, o GOOGLE_API_KEY, o Ollama
```

```bash
npm start
```

Panel en `http://localhost:3000`. Introduce tu clave de API en la cabecera.

### Uso desde un cliente OpenAI

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="<tu SYNAPSE_API_KEY>",   # no la clave del proveedor
)

client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hola"}],
)
```

La credencial del proveedor vive en el gateway, no en el cliente. Ese es el
punto: la aplicación deja de custodiar claves.

---

## Configuración

Todas las variables están documentadas en [`.env.example`](.env.example). Las que
cambian el comportamiento de forma más significativa:

| Variable | Efecto |
| :-- | :-- |
| `SYNAPSE_API_KEYS` | Obligatoria en producción. Lista separada por comas para rotar sin downtime. Cada clave define un inquilino: las cachés y los registros no se mezclan entre ellas. |
| `SYNAPSE_VAULT_KEY` | Clave maestra real del vault. Sin ella el cifrado en reposo no protege frente a acceso local. |
| `SYNAPSE_DLP_ON_DETECTION` | `redact` enmascara y continúa. `block` rechaza la petición con 403. |
| `SYNAPSE_CACHE_SEMANTIC` | Desactivada por defecto. Al activarla, una respuesta generada para un prompt distinto puede servirse a otro parecido. Es un intercambio de exactitud por coste, no una optimización gratuita. |
| `SYNAPSE_ALLOW_MOCK_PROVIDER` | El proveedor `mock` devuelve texto sintético etiquetado como tal. El arranque **falla** si se activa con `NODE_ENV=production`. |
| `SYNAPSE_TRUST_PROXY_HOPS` | Número de proxies de confianza. Con `0`, `X-Forwarded-For` se ignora por completo. |

### Precios de los modelos

`server/config/models.json` contiene el catálogo. **Los precios son un parámetro
tuyo, no un dato verificado por SynapseAI.** Revísalos contra la página de
precios de cada proveedor y rellena `_pricesReviewedAt`; hasta entonces el
gateway avisa en el arranque y marca los importes como no verificados en la API.

---

## Despliegue

```bash
docker build -t synapse-gateway .
docker run -d \
  --name synapse \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -e NODE_ENV=production \
  -v synapse-data:/app/data \
  synapse-gateway
```

El proceso corre sin privilegios, el volumen `/app/data` guarda el vault, el
registro de auditoría y las directrices. Publica el puerto solo en la interfaz
que necesites: el gateway custodia credenciales de proveedores.

Con `NODE_ENV=production` el arranque se aborta si falta autenticación, si
`SYNAPSE_CORS_ORIGINS` contiene `*` o si el proveedor mock está activo.

`GET /healthz` devuelve `503` cuando ningún proveedor real está disponible.

---

## Pruebas

```bash
npm test                   # 98 pruebas unitarias
npm run test:integration   # 23 pruebas extremo a extremo contra un upstream simulado
npm run bench              # sobrecarga del gateway y aciertos de caché
```

Las pruebas de integración levantan un servidor que imita el protocolo de
OpenAI, así que ejercitan el cliente HTTP real, el parser SSE real y el pipeline
real sin gastar dinero ni requerir red.

---

## Extensión de navegador

`extension/` contiene una extensión Manifest V3 que intercepta el envío en
ChatGPT, Claude y Gemini. La detección ocurre **dentro de la página**: el
borrador no viaja a ningún sitio. Al detectar algo, ofrece enmascarar, cancelar
o enviar igualmente.

Su alcance es limitado por construcción: engancha el editor y el botón de envío
visibles, así que un rediseño del sitio puede romperla y siempre puede existir
una vía de envío que no conozca. Es un cinturón de seguridad para el pegado
accidental, no un control que no se pueda evitar. Un control real vive en la red
(proxy corporativo) o en la política del navegador gestionado.

---

## Alcance y límites

Merece la pena decirlo antes de que alguien lo descubra en producción:

- **Un proceso, un nodo.** Las directrices y la caché están en memoria y en
  archivos JSON con escritura atómica. Sirve para un despliegue de un solo
  proceso. Varias réplicas necesitan un almacén compartido.
- **La licencia es honesta sobre sí misma.** Es verificación de firma offline
  ejecutándose en hardware del cliente. Disuade el uso compartido casual; no es
  un control de ingresos. Quien controle el binario puede saltárselo.
- **El registro de auditoría no es una cadena de bloques.** Detecta manipulación
  posterior por parte de quien no pueda recalcular la cadena. Con
  `SYNAPSE_AUDIT_HMAC_KEY` guardada fuera de la máquina, también autentica.
- **`server/p2p/` y `server/security/ast-sandbox.js` son prototipos.** No están
  conectados al servidor y sus dependencias no se instalan por defecto. Ver
  [`docs/EXPERIMENTAL.md`](docs/EXPERIMENTAL.md).
- **Los planes de licencia no se aplican.** `PLAN_TIERS` declara cuotas que
  ningún middleware consulta, y el paquete es MIT. Es una decisión abierta,
  no una funcionalidad; la API lo expone como `enforcement.enforced: false`.
- **Sin métricas de precisión del DLP.** No hay corpus etiquetado, así que nadie
  puede decir cuántos secretos se escapan. Para un comprador de seguridad esa es
  la única cifra que importa, y todavía no existe.

---

## Documentación

- [`docs/AUDIT_2026.md`](docs/AUDIT_2026.md) — auditoría completa: qué estaba roto y qué se corrigió.
- [`docs/VIABILIDAD.md`](docs/VIABILIDAD.md) — análisis adversarial de viabilidad y la decisión resultante.
- [`docs/SECURITY.md`](docs/SECURITY.md) — modelo de amenazas y lo que este sistema no defiende.
- [`docs/BENCHMARK_RESULTS.md`](docs/BENCHMARK_RESULTS.md) — mediciones reproducibles y su lectura honesta.
- [`docs/EXPERIMENTAL.md`](docs/EXPERIMENTAL.md) — módulos prototipo no conectados.

## Licencia

MIT.

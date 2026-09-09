# Auditoría técnica — septiembre 2026

Auditoría completa del proyecto antes de considerarlo apto para un entorno real.
Cada hallazgo se verificó ejecutando el código, no leyéndolo.

**Veredicto de partida:** el sistema arrancaba y el panel mostraba métricas
verdes, pero **no realizaba inferencia**. El gateway fabricaba respuestas con
plantillas de texto y las presentaba como salida de Gemini, GPT-4o o Claude. Todo
lo que se apoyaba en esa capa —benchmarks, ahorro, latencia— era ficción
derivada.

---

## Hallazgos críticos

### C1 · El gateway no llamaba a ningún modelo

`gateway.controller.js` construía la respuesta con literales:

```js
rawGeneratedResponse = `[SynapseAI Gateway] Consulta procesada con éxito por
  **${routeResult.selectedModel.name}** (${routeResult.selectedModel.tier}).…`;
```

El único adaptador con una llamada HTTP real (`claude-adapter.js`) caía en
silencio a una «simulación local de alta fidelidad» ante cualquier error,
incluida una clave inválida. Un cliente no tenía forma de distinguir una
respuesta del modelo de una fabricada.

**Corregido.** Capa de proveedores nueva (`server/providers/`) con OpenAI,
Anthropic, Google y Ollama, streaming real, timeouts y errores tipados. El
proveedor `mock` existe, pero prefija cada respuesta con
`[RESPUESTA SINTÉTICA — proveedor mock, sin inferencia real]` y el arranque falla
si se activa en producción. Sin proveedor configurado, la petición devuelve 503;
nunca texto inventado.

### C2 · La caché servía la respuesta equivocada

`semanticCache.get(prompt, contextoDeMemoria)` vectorizaba `contexto + prompt`.
El contexto era idéntico en todas las peticiones y varias veces más largo que el
prompt, así que dominaba el coseno. Verificado en ejecución:

```
POST "receta de paella valenciana para 8 personas"
→ source: SEMANTIC_CACHE, similarity: 0.94
→ respuesta: "…Consulta procesada por Google Gemini 2.0 Flash…"
   (generada para "Hola, ¿qué es un gateway de IA?")
```

Con inferencia real, esto significa que un usuario recibe la respuesta que se
generó para la pregunta de otro. En un despliegue multiinquilino, es fuga de
datos entre clientes.

**Corregido.** `server/core/response-cache.js`: el contexto forma parte de la
*clave* (junto con inquilino y modelo), nunca del vector. Coincidencia exacta por
defecto; la de similitud exige umbral 0.97 y un mínimo de palabras clave
compartidas, y está desactivada salvo activación explícita. Cubierto por pruebas
de regresión.

### C3 · Ninguna autenticación

Toda la API estaba abierta y `cors()` aceptaba cualquier origen. Cualquier
proceso local —o cualquier página web abierta en el navegador del usuario— podía
leer el estado del vault, borrar las directrices corporativas, descargar el
historial de prompts o gastar el presupuesto de API del operador.

**Corregido.** Bearer token obligatorio con comparación en tiempo constante,
lista blanca de orígenes CORS y arranque abortado en producción sin claves. La
identidad del inquilino se deriva de la clave, lo que además aísla cachés y
registros.

### C4 · El webhook de facturación regalaba el producto

`POST /api/webhooks/stripe` no verificaba firma. Publicar
`{"type":"checkout.session.completed"}` devolvía una licencia ENTERPRISE firmada,
válida y gratuita.

**Corregido.** Verificación HMAC-SHA256 de `Stripe-Signature` con ventana de
tolerancia contra reproducción, comparación en tiempo constante y endpoint
deshabilitado si falta el secreto. La emisión de licencias se traslada al
servicio de fulfilment del proveedor: la clave de firma no puede vivir en una
instalación del cliente.

### C5 · El motor DLP almacenaba en claro lo que decía proteger

Cada detección escribía `sampleBefore: rawText.substring(0,100)` en el registro
de auditoría, y el panel lo renderizaba en una columna llamada «Texto Original
(Muestra)». La herramienta comprada para impedir que los secretos salgan
construía un archivo con esos secretos y los mostraba en pantalla.

Añadido: la extensión enviaba el borrador completo del usuario al gateway en
cada pulsación de tecla (con debounce), alimentando ese mismo registro.

**Corregido.** El registro guarda un HMAC salteado por proceso, no el texto. Los
fragmentos de detección ya no revelan el prefijo de una credencial. La retención
en claro existe como opción explícita del operador, desactivada por defecto. La
extensión detecta ahora dentro de la página y no envía texto a ningún sitio.

### C6 · La clave privada de firma viajaba con el producto

`data/keys/vendor_private.pem` estaba en el árbol del proyecto. Cualquier cliente
podía emitirse licencias de cualquier plan, o sustituir `vendor_public.pem` por
su propio par de claves.

**Corregido parcialmente, y así hay que decirlo.** Se añadió `.gitignore`, un
error en cada arranque si la clave está presente, y verificación que falla si no
hay clave pública. Pero la limitación de fondo es estructural: la verificación de
firma offline se ejecuta en hardware del cliente y siempre puede parchearse.
Documentado como tal en el código y en el README, en lugar de presentarse como
«sistema de licenciamiento 100 % blindado».

**Acción pendiente del propietario:** rotar ese par de claves. Debe considerarse
comprometido.

---

## Hallazgos altos

| # | Hallazgo | Estado |
| :-- | :-- | :-- |
| A1 | `package.json` declaraba 2 dependencias; el código importaba `ajv`, `node-sql-parser`, `bash-parser`, `circomlibjs`, `libp2p` y seis paquetes `@libp2p/*`. Un `npm install` limpio producía un proyecto roto. | Corregido: dependencias reales declaradas; los módulos prototipo pasan a opcionales. |
| A2 | `auditLedger.exportCSV()` no existía. `/api/security/export?format=csv` devolvía 500. | Corregido e implementado con escapado RFC 4180. |
| A3 | El limitador de tasa confiaba en `X-Forwarded-For` sin proxy configurado: cualquiera elegía una identidad nueva por petición y lo evitaba por completo. Su `Map` además crecía sin límite. | Corregido: `TRUST_PROXY_HOPS`, barrido y cota de clientes rastreados. |
| A4 | El streaming era falso: se esperaba la respuesta completa y se troceaba en palabras. Se anunciaba la latencia de un streaming que no existía. | Corregido: relevo real del stream del proveedor, con redactor de cola que detecta secretos partidos entre fragmentos. |
| A5 | `totalTokensSaved += estimatedTokens * 0.45` — el 45 % era una constante inventada. `totalMoneySavedUSD` acumulaba la diferencia contra un modelo de referencia y la llamaba ahorro. | Corregido: `core/telemetry.js` cuenta solo eventos medidos; la comparación se publica como comparación. |
| A6 | Las directrices del Memory Hub vivían solo en memoria: se perdían en cada reinicio mientras el panel las presentaba como política persistente. | Corregido: persistencia con escritura atómica. |
| A7 | Las «pruebas red team» imprimían `🏆 100% BLINDADO` de forma incondicional. Varias fallaban al importar y aun así declaraban victoria. | Sustituidas por 65 pruebas con aserciones reales (49 unitarias, 16 de integración). |
| A8 | Las pruebas ZK generaban una prueba Groth16 falsa (constantes escritas a mano más un `setTimeout` de 200 ms como «operaciones de curva elíptica») y el sistema la presentaba como auditabilidad de conocimiento cero. | Retirado. La cadena de auditoría usa hashes y HMAC, y documenta con precisión qué garantiza. |
| A9 | `HardwareTelemetry` ejecutaba `wmic` de forma síncrona en el camino de la petición. `wmic` está retirado en Windows 11. | El módulo deja de usarse en el enrutado; queda fuera del pipeline. |
| A10 | El DLP usaba `replace()`: enmascaraba la primera aparición de un secreto y dejaba el resto en claro. | Corregido con `replaceAll` y deduplicación. |

---

## Hallazgos medios

- El vault derivaba su clave de `hostname`, `platform`, `arch`, modelo de CPU y
  directorio home. Nada de eso es secreto: quien lea el archivo puede derivar la
  clave. Ahora hay modo `env` con clave real, y el modo degradado se anuncia en
  cada arranque y en la API.
- La clave pública embebida por defecto no era un PEM válido, así que el
  verificador siempre lanzaba excepción y el mensaje de error era engañoso.
- `TLSShield` contenía huellas SPKI inventadas y nunca se invocaba desde ninguna
  ruta de ejecución.
- Dos frontends competían: `public/` (servido) y `client/frontend/` (React, no
  servido, con la cabecera «100% Real API integration - Zero mock»).
- El manejador de errores devolvía el stack trace al cliente.
- Sin `.gitignore`, sin `.env.example`, sin Dockerfile, sin healthcheck, sin
  apagado ordenado.
- `express.json({limit:'10mb'})` frente a un límite declarado de 100 000
  caracteres de prompt.

Todos corregidos salvo el frontend duplicado, que queda documentado como
prototipo en `client/README.md`.

---

## Un fallo introducido durante la reparación

La primera versión del relevo de streaming escuchaba `req.on('close')` para
detectar la desconexión del cliente. En Node, ese evento se emite en cuanto
termina de leerse el cuerpo de la petición —de inmediato en cualquier POST
normal— así que el stream se abortaba antes del primer fragmento. Lo detectó la
prueba de integración de streaming, no la revisión manual. Corregido escuchando
`res.on('close')` con comprobación de `writableEnded`.

Se documenta porque es la mejor evidencia disponible de que la suite de pruebas
nueva hace lo que las anteriores no hacían: fallar.

---

## Segunda ronda: revisión adversarial

Tras la remediación, cinco revisores independientes con el encargo explícito de
demoler el proyecto lo atacaron desde mercado, seguridad, ingeniería, derecho y
finanzas. Los frentes de seguridad e ingeniería reprodujeron defectos reales
ejecutando el código. Todos están corregidos y cubiertos por pruebas de
regresión.

### Defectos reproducidos y corregidos

| # | Defecto | Estado |
| :-- | :-- | :-- |
| R1 | **La caché de streaming almacenaba el texto sin redactar.** La ruta no-streaming guardaba la respuesta enmascarada; la de streaming guardaba la original. El filtro de salida se anulaba a sí mismo: el primer usuario veía el secreto enmascarado y todos los siguientes recibían el original desde caché. Introducido durante la propia remediación. | Corregido: se cachea el texto emitido. |
| R2 | **El motor no cubría formatos habituales.** Pasaban íntegros tokens de Slack, Stripe, GitHub fine-grained, GitLab, bloques PEM, cadenas de conexión, JWT y claves de Google. Un JSON de cuenta de servicio de GCP salía con el correo redactado y la clave privada intacta —incrementando además el contador de detecciones, de modo que el panel informaba de éxito. | Corregido: nueve patrones nuevos, JWT validado decodificando su cabecera. |
| R3 | **El desofuscador corrompía prompts legítimos.** El texto normalizado era el que se enviaba al modelo, así que la prosa en cirílico salía transliterada y un adjunto en base64 que el usuario pedía decodificar era sustituido por `[DECODED_BASE64: …]`. El modelo respondía a una pregunta que nadie hizo. | Corregido: la detección usa una copia normalizada, la redacción se aplica al original. Cuando un secreto solo es visible tras normalizar, ninguna de las dos opciones es correcta y la petición se rechaza. |
| R4 | **Truncar la cabecera del registro de auditoría era indetectable.** `_restoreTail` cargaba los últimos N registros sin verificar el enlace y recalculaba el total desde el propio archivo manipulado. Borrar los primeros registros —o editar cualquiera anterior a la ventana en memoria— dejaba la verificación en `isValid: true`. | Corregido: se verifica el archivo completo y se exige que la numeración arranque en el bloque génesis. |
| R5 | **El filtro de inyección no hablaba español.** 15 de 17 jailbreaks escritos a mano lo atravesaban: formas en singular, español, delimitadores `<<SYS>>`, y "From now on you are DAN" —que fallaba solo porque la expresión exigía literalmente "you are now"—. | Corregido: 14 de 15 bloqueados, 0 falsos positivos sobre texto legítimo. Sigue siendo una lista de patrones, no un clasificador. |
| R6 | **El filtro solo inspeccionaba el último mensaje.** Bastaba con poner la inyección en un turno anterior de la conversación: el modelo la leía y el filtro no la miraba. | Corregido: se inspeccionan todos los turnos de usuario. |
| R7 | **Agotamiento de memoria con un solo cliente secuencial.** La caché vectorizaba siempre, incluso con la búsqueda por similitud desactivada —el valor por defecto—. Con documentos largos el proceso moría tras unos cientos de peticiones, sin concurrencia. | Corregido: el vector solo se construye cuando puede usarse. |
| R8 | **Los streams no se cancelaban.** El temporizador se limpiaba al recibir las cabeceras, así que solo cubría el tiempo hasta el primer byte. Un cliente que colgaba dejaba el stream corriendo y facturando. | Corregido: temporizador de inactividad refrescado en cada fragmento, y la desconexión del cliente aborta la llamada. |
| R9 | **Estampida de caché.** Cincuenta peticiones idénticas simultáneas fallaban las cincuenta en caché y se pagaban cincuenta veces. | Corregido: las peticiones idénticas en vuelo comparten una sola llamada. |
| R10 | **Compatibilidad OpenAI incompleta.** Sin `/v1/models` (que LangChain y los SDK consultan al arrancar), sin tool calling —el rol `tool` se rechazaba con 400—, sin contenido multimodal, y con `max_tokens` y `temperature` inventados cuando el cliente no los enviaba, alterando la respuesta por el mero hecho de apuntar al gateway. | Corregido en los cuatro puntos. |
| R11 | **Sin RBAC.** La clave que la extensión guarda en el navegador de cada empleado abría también el vault de credenciales y el registro completo de auditoría. | Corregido: claves con ámbito (`full`, `inference`, `report`). |
| R12 | **CIF y RFC sin checksum; CURP, CPF y CNPJ inexistentes.** El "activo diferencial" en identificadores iberoamericanos era, en realidad, un patrón y medio: solo el DNI validaba. | Corregido: `server/identity-checksums.js` con los siete algoritmos, verificados contra identificadores reales conocidos. |
| R13 | **El correo redactado era reidentificable.** Conservaba dos caracteres del usuario y el dominio íntegro; en una empresa pequeña eso nombra a la persona. | Corregido: solo sobrevive el dominio de primer nivel. |
| R14 | **La decisión del usuario quedaba fuera de la cadena.** El endpoint de la extensión registraba en el log de aplicación —no en el registro a prueba de manipulación— el dato con peso disciplinario: "se le advirtió y lo envió igualmente". | Corregido: la decisión forma parte del registro encadenado. |
| R15 | **Los planes de licencia no se aplicaban en ninguna parte.** `PLAN_TIERS` definía cuotas y funciones que ningún middleware consultaba: el plan FREE tenía el cien por cien del producto, con el paquete distribuido bajo licencia MIT. | Documentado como decisión abierta, no como funcionalidad. La API declara `enforcement: { enforced: false }` para que ningún panel pueda insinuar lo contrario. |

### Lo que los revisores exageraron

En dos puntos conviene ser justo con el proyecto:

- El frente jurídico sostuvo que los documentos comerciales "siguen prometiendo"
  cifras retractadas. Los siete llevan desde esta auditoría un aviso de siete
  líneas que dice, literalmente, que no se usen como material comercial. La
  exposición existe por lo que ya circuló, no por lo que hoy contiene el
  repositorio.
- Dos frentes presentaron el DLP iberoamericano como un activo existente. No lo
  era: hasta R12, solo el DNI validaba. Eso no debilita la recomendación de
  construirlo; explica por qué nadie lo ha copiado.

### Lo que sigue sin resolver tras la segunda ronda

Se mantiene en pie lo estructural: un solo proceso, sin corpus etiquetado ni
métricas publicadas de precisión, sin límites de gasto, la contradicción entre
la licencia MIT y unos planes de pago, y el hecho de fondo de que el gateway
solo ve el tráfico que alguien decide entregarle.

---

## Tercera ronda: caza de bugs sobre el código ya reparado

Barrido dirigido sobre el código reconstruido, con pruebas de concepto
ejecutables. Cinco de los siete defectos los había introducido la propia
reparación, que es exactamente por qué esta ronda existía.

| # | Defecto | Cómo se demostró |
| :-- | :-- | :-- |
| B1 | **La redacción en streaming no funcionaba.** El redactor escaneaba solo el fragmento que iba a liberar, nunca el búfer completo, así que un secreto que empezaba en la zona liberada y continuaba en la cola no aparecía entero en ninguna cadena escaneada. Con la cola por defecto se escapaban en claro una clave de OpenAI, una cadena de conexión con contraseña y un bloque PEM. Fallaba **en silencio**: el contador de detecciones marcaba cero. | Sonda con secretos de 40, 65 y 252 caracteres troceados de 12 en 12. |
| B2 | **Ninguna cola fija podía bastar.** Un bloque PEM no tiene longitud acotada. | Se retiene desde el «opener» (`-----BEGIN`, `eyJ`, `sk-`…) hasta que cierra, con un tope de memoria que se señaliza en lugar de fingir que redactó. |
| B3 | **La coalescencia fusionaba conversaciones distintas.** La clave era solo el último mensaje del usuario, así que dos conversaciones que terminaban en «¿qué opinas?» compartían respuesta. La segunda recibía el contexto confidencial de la primera —la misma clase de fuga que el hallazgo C2, por otra puerta. | Dos conversaciones concurrentes: una llamada al proveedor y ambas recibieron la respuesta construida sobre el presupuesto secreto de la otra. |
| B4 | **Inundar la tabla del limitador devolvía la cuota.** El barrido expulsaba por orden de inserción, incluidos los cubos castigados: 200 identidades nuevas y la víctima volvía a pasar. | Ahora se expulsan primero los caducados y luego solo los que están por debajo de su cuota; si solo quedan clientes castigados, se rechazan las identidades nuevas en lugar de olvidar a los abusadores. |
| B5 | **La tabla de canarios crecía sin límite y encarecía cada respuesta.** La purga solo eliminaba entradas de más de una hora, y el identificador de sesión lo elige el cliente en una cabecera. Con 20.000 sesiones, cada respuesta costaba 0,79 ms frente a 0,21 ms con 5.000. | Tope duro de 5.000 con desalojo LRU, y la detección de salida pasa a buscar el prefijo común con una sola expresión: coste independiente del número de sesiones, y además detecta canarios de sesiones ya desalojadas. |
| B6 | **Un secreto inflaba los contadores.** El búfer se reescanea en cada fragmento, así que una sola clave filtrada escribía una entrada de auditoría por trozo. | Detecciones deduplicadas por hash y auditoría desactivable por fragmento; el pipeline registra una sola vez. |
| B7 | **`cosine` devolvía dos tipos distintos** —el número `0` o un objeto—, de modo que al desestructurar el caso degenerado se obtenía `undefined` y toda comparación posterior era falsa por accidente, no por diseño. | Devuelve siempre `{ similarity, overlap }`. |

Menores, corregidos en la misma pasada: el archivo temporal del vault tenía
nombre fijo (dos escrituras podían pisarse y dejar un vault a medio serializar);
el endpoint de la extensión aceptaba un número ilimitado de reglas por evento,
lo que permitía inflar la cadena de auditoría desde un navegador; y una
desconexión del cliente se contabilizaba como fallo del gateway, convirtiendo la
tasa de error en una medida del comportamiento del usuario.

También se eliminó un byte NUL literal que un parche había dejado dentro de una
expresión de código, y se verificó que no queda ningún carácter de control en
los 82 archivos fuente.

---

## Estado de verificación

```
npm test                 → 98 pruebas, 98 correctas
npm run test:integration → 23 pruebas, 23 correctas
npm run bench            → sobrecarga ≈ 0 ms p50 en proceso; caché 37 % con 40 % de duplicación declarada
```

Advertencia sobre el benchmark, señalada por el frente de ingeniería: mide en
proceso, sin pasar por Express. Medido por HTTP, la sobrecarga real es de unos
15 ms con un cliente y sube a unos 330 ms con cien concurrentes, porque el
escaneo DLP y el enrutado son trabajo de CPU en un único hilo. Esa cifra es la
que hay que usar para dimensionar, no la de 0 ms.

Las pruebas de integración levantan un servidor que imita el protocolo de OpenAI
y verifican, entre otras cosas, que el prompt que llega al proveedor va
enmascarado, que un acierto de caché no genera tráfico saliente y que un intento
de inyección no llega al modelo.

---

## Lo que sigue sin resolver

No es una lista de deseos, sino aquello que impide afirmar que el sistema está
listo para un cliente exigente:

1. **Sin métricas de precisión del DLP.** No hay corpus etiquetado, así que
   nadie puede decir cuántos secretos se escapan. Para un comprador de
   seguridad, esa es la única cifra que importa.
2. **Un solo proceso.** Caché y directrices son locales al proceso. Dos réplicas
   detrás de un balanceador divergen.
3. **Sin límites de gasto.** El gateway ve el coste pero no lo detiene. Un
   cliente en bucle agota el presupuesto sin que nada intervenga.
4. **Sin evaluación de calidad del enrutado.** Enviar a un modelo más barato es
   fácil; demostrar que la respuesta sigue sirviendo es el producto.
5. **La cadena de auditoría vive en la máquina auditada.** Sin envío externo, no
   resiste a un operador adversario.
6. **El filtro de inyección es una lista de patrones.** Frena copiar-pegar de
   jailbreaks conocidos; no frena a nadie con intención y cinco minutos.

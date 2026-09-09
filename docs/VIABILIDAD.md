# Análisis de viabilidad — septiembre 2026

Cinco revisores independientes, con el encargo explícito de **demoler** el
proyecto desde ángulos distintos, y un árbitro que pesa la evidencia y decide.
Ninguno tenía interés en que la idea sobreviviera. Sus conclusiones se recogen
aquí sin suavizar.

---

## Los cinco frentes

### 1 · Mercado

> *«Proyecto de ingeniería honesto envuelto en un plan de negocio que su propio
> repositorio desmiente.»*

La categoría se cerró mientras se construía el producto. LiteLLM es gratuito,
MIT, con 140+ proveedores y financiación. Cloudflare regala caché, límite de
tasa y analítica en su AI Gateway. Palo Alto compró Portkey en mayo de 2026 e
integró el gateway en Prisma AIRS; SentinelOne compró Prompt Security; Zscaler
compró SquareX precisamente por la extensión de navegador. Microsoft Purview
lleva DLP de prompts a toda licencia Copilot desde abril de 2026.

Probabilidad estimada de alcanzar 10.000 $ de MRR en doce meses: **2-3 %**.

### 2 · Seguridad

> *«No lo desplegaría como control de seguridad; a lo sumo como indicación de
> higiene para pegados accidentales.»*

Reprodujo por ejecución una lista de evasiones que hoy están corregidas (ver
[`AUDIT_2026.md`](AUDIT_2026.md), segunda ronda). Su objeción de fondo no se
arregla con código:

> *«El gateway solo ve el tráfico que se le entrega voluntariamente.»*

Un empleado decidido no lo usa; uno descuidado filtra en un formato que el
patrón no cubre. Y advierte de una inversión de riesgo: concentrar las claves de
todos los proveedores y el historial completo de prompts en un proceso crea un
objetivo más valioso que el problema que resuelve, con el agravante de que un
panel en verde invita a relajar la formación y la política.

### 3 · Ingeniería

> *«El producto pide ser un sistema distribuido y sigue siendo un proceso.»*

Reprodujo fallos concretos en el camino crítico —todos corregidos ya— y midió lo
que el benchmark propio no medía: la sobrecarga real por HTTP es de unos 15 ms
con un cliente y sube a unos 330 ms con cien concurrentes, porque el escaneo DLP
y el enrutado son trabajo de CPU en un único hilo.

Coste estimado hasta un v1 defendible: **9-14 meses-persona**, más medio FTE
perpetuo para mantener cuatro adaptadores, un catálogo de precios y una lista de
patrones.

Su conclusión sobre la decisión de construir: lo diferencial son unas 300 líneas
de DLP que caben en un middleware **delante** de LiteLLM. Construir el gateway
entero para envolverlas fue la decisión equivocada.

### 4 · Legal

> *«El código es más honesto que el material comercial.»*

Exposiciones señaladas: publicidad con cifras que la propia auditoría retracta
(arts. 5 y 7 de la Ley 3/1991; dolo *in contrahendo*, arts. 1269-1270 CC);
condición de encargado del tratamiento sin contrato del art. 28 RGPD, sin
registro y sin evaluación de impacto, con los segmentos objetivo declarados en
Salud (art. 9) y despachos (secreto profesional); y la extensión como
monitorización laboral sin cumplir el art. 87.3 LOPDGDD ni el art. 64.4.d) ET.

Su formulación más útil es la trampa del producto de cumplimiento:

> *«Una herramienta de productividad que falla decepciona. Una de cumplimiento
> que falla transfiere culpa.»*

### 5 · Financiero

> *«Un commodity con cuatro sustitutos gratuitos y un coste de servir que supera
> al precio desde el primer ticket.»*

429 clientes PRO para equivaler a un salario. Cada cliente de 19 $/mes compra
3,1 horas de soporte al año; el punto de equilibrio está en 0,26 tickets al mes,
y la tasa real en infraestructura auto-alojada es de 0,3 a 1,0. Conversión
realista de OSS auto-alojado a pago: 0,05-0,2 %.

Valor esperado a doce meses ≈ **10.700 $** de ingreso bruto frente a 70-90.000 $
de coste de oportunidad. **EV neto ≈ −70.000 $.**

---

## La decisión

> **Mata el producto de pago: borra la capa de licencias y los documentos
> comerciales, publica el gateway como proyecto MIT honesto, y construye el
> corpus etiquetado de PII iberoamericana como único activo — vendiendo mientras
> tanto auditorías de fuga de datos en IA a 4-8 k€ por encargo, con este
> repositorio como herramienta.**

### Por qué

No hay un negocio de licencias que defender: nunca llegó a existir. `PLAN_TIERS`
define cuotas que ningún middleware consulta y `package.json` dice MIT, así que
el producto de 499 $/mes ya estaba regalado con permiso legal explícito.

Lo que sí existe es una **credencial**: 105 pruebas reales, y una auditoría
publicada que admite por escrito que el gateway fabricaba las respuestas y
documenta un fallo introducido durante su propia reparación. Esa capacidad de
autocorrección demostrada es lo que se compra en una auditoría de 4-8 k€, y no
se puede copiar en un fin de semana.

### Dónde exageraron los demoledores

Un árbitro que solo confirma no sirve. Dos correcciones:

- El frente legal afirmó que los documentos comerciales «siguen prometiendo» las
  cifras retractadas. Los siete llevan un aviso en la primera línea que dice
  literalmente que no se usen como material comercial. La exposición real es por
  lo que ya circuló, no por lo que hoy contiene el repositorio. *(Aun así:
  bórralos. Conservarlos no aporta nada y obliga a discutirlo con un abogado.)*
- Dos frentes presentaron el DLP iberoamericano como un activo existente. **No lo
  era**: hasta esta ronda solo el DNI validaba checksum; CIF y RFC eran patrones
  sin verificación, y CURP, CPF y CNPJ no existían. Ya están implementados y
  probados. Que estuviera sin construir no debilita la recomendación: explica por
  qué nadie lo ha copiado.

### Qué se conserva y qué se tira

**Se conserva:** `identity-checksums.js` y `dlp-engine.js` (el núcleo del
futuro), `prompt-injection-shield.js` (los patrones en español son trabajo
original), `audit-chain.js`, `response-cache.js`, `stream-redactor.js`,
`inflight.js`, `providers/`, la suite de pruebas completa, y
`AUDIT_2026.md` junto con `BENCHMARK_RESULTS.md` — que son el mejor material
comercial disponible, porque prueban que su autor encuentra lo que otros
esconden.

**Se tira:** `license-manager.js`, `generate_license.js`, el webhook de Stripe y
su controlador; `GO_TO_MARKET_STRATEGY.md`, `MARKET_RESEARCH.md`, `ROADMAP.md`;
`server/p2p/`, los módulos ZK, `ast-sandbox.js`, `hardware-telemetry.js`,
`tls-shield.js`, `circuits/`; y el frontend duplicado `client/frontend/`.

### El plan

**Primera semana.** Rotar el par de claves comprometido. Borrar en un solo commit
todo lo de la lista anterior, titulado *«Retirada del modelo de licencias: el
producto es MIT»*. Reescribir el README sin planes ni precios. Publicar en
GitHub. Un único post técnico: *«Auditando mi propio gateway de IA: fabricaba las
respuestas»*, con el diff del `req.on('close')`. Ése es el anzuelo.

**Primer mes.** Corpus v0: 300 documentos etiquetados (nóminas, facturas,
historiales, contratos, tickets). Publicar precisión y exhaustividad por tipo,
con los fallos incluidos. Definir una oferta de auditoría de 4.000 € / 5 días.
Contactar 30 empresas españolas de 50-500 empleados con IA en producción.

**Tres meses.** Corpus v1: 1.000 documentos, versionado y reproducible. Empaquetar
el DLP como *guardrail plugin* de LiteLLM —donde está el tráfico; no compitas con
LiteLLM, enchúfate a él—. Cerrar dos encargos. Nada de RBAC avanzado, nada de
multiproceso, nada de límites de gasto: es infraestructura de un producto que ya
no se va a vender.

### La prueba de fuego

**31 de marzo de 2027.** Dos condiciones, ambas verificables por un tercero:

1. **≥ 8.000 € facturados y cobrados** en encargos de auditoría. Facturas
   emitidas y pagadas, no propuestas ni «interesados».
2. **Corpus v1 publicado**: ≥ 1.000 documentos etiquetados y exhaustividad ≥ 0,90
   en DNI/NIE, CIF, RFC, CURP y CPF, medida sobre un conjunto retenido que no se
   usó para ajustar patrones.

Si falla cualquiera de las dos, se abandona. No se prorroga ni se pivota otra
vez. Aviso intermedio el **15 de diciembre de 2026**: al menos una factura
cobrada y el corpus v0 publicado. Sin ninguna factura en esa fecha, el abandono
se adelanta a enero — el mercado ya habrá respondido.

---

## Lo que no se puede repetir

1. **No publicar una cifra que no se haya medido.** El 97 % de ahorro, el 47 % de
   tokens, el 45 % constante en `totalTokensSaved`, el «100 % BLINDADO»
   incondicional. Si el corpus da 0,71 de exhaustividad, se publica 0,71.
2. **No dejar que el código mienta en silencio.** El *fallback* a «simulación
   local de alta fidelidad» ante una clave inválida fue el pecado original: un
   fallo presentado como éxito. Ningún camino de error debe devolver algo que
   parezca correcto. Preferir 503.
3. **No poner precio a lo que no se puede hacer cumplir.** `PLAN_TIERS` con MIT
   en `package.json` es la misma mentira en otro registro.
4. **No prometer un control de seguridad que el sistema no ejerce.** El gateway
   solo ve el tráfico que se le entrega. Vender eso como DLP corporativo fabrica
   falsa sensación de control, y es el único error de esta lista que puede
   acabar en un tribunal en vez de en un post-mortem.
5. **No construir once días de funcionalidad antes de tener un cliente.** El
   siguiente commit debería ser corpus, y el corpus solo existe porque alguien
   pagó por saber qué se le escapa.

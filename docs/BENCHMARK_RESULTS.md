# Mediciones

Reproducible con `npm run bench` (`tests/benchmarks/gateway_overhead.js`).
Ejecución de referencia: Node 24, Windows 11, upstream simulado con 50 ms fijos
de latencia, 200 iteraciones más 20 de calentamiento.

---

## Retirada del benchmark anterior

La versión previa de este documento afirmaba **97 % de ahorro financiero**,
**47 % menos tokens** y **88 % más rápido**. Esas cifras no eran medidas; eran
artefactos del montaje:

1. **La línea base era un hombre de paja.** Comparaba SynapseAI contra un
   escenario en el que *cada* petición —incluido «traduce esta frase»— se
   enviaba a un modelo insignia sin ninguna caché. Ningún equipo opera así, de
   modo que el «ahorro» era la diferencia contra una decisión que nadie toma.

2. **El workload contenía las respuestas.** De 30 consultas, 11 eran duplicados
   literales. La tasa de aciertos de caché medía la composición del fixture, no
   una propiedad del producto.

3. **Nada llamaba a un modelo.** Las latencias comparadas (`650 ms` frente a
   `79 ms`) eran constantes escritas en el catálogo de modelos. No se midió una
   sola inferencia real.

4. **La caché tenía un fallo que inflaba los aciertos.** El contexto de sistema
   —idéntico en todas las peticiones y mucho más largo que el prompt— dominaba
   el vector de similitud, así que consultas sin relación alguna coincidían por
   encima del umbral. Una ejecución del arnés antiguo llegaba a reportar
   «100 % (30/30 hits)». Eso no era eficiencia: era el motor devolviendo la
   respuesta equivocada.

Ese punto 4 está corregido y cubierto por una prueba de regresión
(`tests/unit/response-cache.test.js`).

---

## 1. Sobrecarga del gateway

Qué cuesta pasar por SynapseAI en una petición que **no** acierta en caché:
escaneo DLP de entrada, filtrado de inyección, enrutado, consulta de caché y
escaneo DLP de salida.

| Ruta | p50 | p95 |
| :-- | --: | --: |
| Llamada directa al proveedor | 78,24 ms | 81,34 ms |
| A través del gateway | 78,02 ms | 81,50 ms |
| **Coste atribuible al gateway** | **≈ 0 ms** | **≈ 0,2 ms** |

La diferencia queda dentro del ruido de medición. Con prompts de tamaño normal,
la sobrecarga del pipeline es despreciable frente a la latencia de inferencia.

**Cómo leerlo:** el upstream es un stub local, así que la red real añadirá su
propia latencia a ambas rutas por igual. Lo que se mide aquí es lo único que
depende de este código.

**Dónde deja de ser cierto:** el escaneo DLP es lineal en el tamaño del texto y
recorre una decena de patrones. Con prompts de 100 000 caracteres el coste sube
de forma perceptible. La caché por similitud, si se activa, recorre las entradas
del inquilino en cada consulta: es O(n) sobre el tamaño de la caché.

## 2. Aciertos de caché

Workload de 120 peticiones construido con un **40 % de duplicación declarado**.

| Métrica | Valor |
| :-- | --: |
| Peticiones ejecutadas | 120 |
| Prompts únicos | 76 |
| Aciertos de caché | 44 (37 %) |
| Latencia de un acierto (p50) | 0,17 ms |
| Tokens no enviados al proveedor | 4 400 |

**Cómo leerlo:** el 37 % es consecuencia del 40 % de duplicación que se
introdujo a propósito. La tasa de aciertos es una propiedad del tráfico del
cliente, no del producto. Un equipo de ingeniería cuyos prompts incluyen
fragmentos de código distintos cada vez verá una tasa cercana a cero. Un bot de
soporte que responde las mismas diez preguntas verá mucho más.

**Sobre el «ahorro»:** un acierto de caché solo ahorra dinero si esa petición se
habría pagado igualmente. Un usuario reintentando porque la primera respuesta no
servía no genera ahorro: genera una respuesta idéntica y peor experiencia.

---

## Lo que estas mediciones no dicen

- **Calidad del enrutado.** Que una consulta vaya a un modelo más barato no
  demuestra que la respuesta sea igual de buena. Medir eso exige un conjunto de
  evaluación del dominio del cliente, y no existe todavía.
- **Precisión del DLP.** No hay corpus etiquetado, así que no se publican
  precisión ni exhaustividad. Lo único verificado es que los checksums descartan
  falsos positivos concretos (`tests/unit/dlp-engine.test.js`).
- **Comportamiento bajo carga.** No se ha medido concurrencia, presión de
  memoria ni degradación con la caché llena.

Publicar cifras sobre cualquiera de esos tres puntos sin haberlos medido es
exactamente lo que hacía el documento anterior.

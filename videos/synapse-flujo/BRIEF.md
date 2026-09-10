---
workflow: general-video
flow: automation
storyboard: yes
message: "Nada llega al proveedor sin cruzar el gateway, y lo que cruzó queda registrado"
destination: docs-embed
aspect: 1920x1080
language: es
audience: "responsables de gestorías, despachos y asesorías que ya usan IA a diario"
length: 90s
angle: mechanism
---

## Intent

Explicar el recorrido completo de una petición por SynapseAI, de forma que se
entienda sin saber qué es un gateway de IA. El tono es el del producto: sobrio,
sin superlativos, y con el límite dicho en voz alta. Motion graphics heredando
el sistema visual del panel — fondo claro, superficie oscura para lo que pesa —
y una escena de captura real, porque el argumento central es precisamente que
no es una animación.

## Assets

- ../../public/css/tokens.css — el color y la tipografía salen de aquí, no se inventa un sistema nuevo.
- Pendiente: captura en vivo del panel en /app, módulo Probar, con el caso de datos personales.
- Pendiente: captura de Auditoría → «Comprobar el registro».

## Customizations

- Match-cut sobre `[REDACTED_ES_DNI_NIE]`: el marcador existe en el grafismo y en
  la captura real, en la misma tipografía y la misma posición. Es la costura de
  la escena 7.
- Las seis capas se recorren en un solo empuje continuo en Z, sin cortes
  intermedios: seis cortes seguidos serían seis tiempos muertos.
- El portador es el token de la petición y cruza la película entera.

## Notes

- Prohibida cualquier cifra que no proceda de una ejecución grabada. La auditoría
  del proyecto retiró «60 % de ahorro» y «respuestas sub-5 ms», y el frente legal
  lo señaló como exposición bajo los arts. 5 y 7 de la Ley 3/1991.
- Sin emoji. Iconografía Lucide, trazo 1.75.
- El puerto real es 3000. El lienzo de diseño dibuja :8787; no aparece ninguno.
- Voz: sin sesión de HeyGen. Se usa el motor local, o se entrega sin narración
  con el texto en pantalla haciendo el trabajo.

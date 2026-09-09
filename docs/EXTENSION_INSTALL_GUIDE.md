# Instalación de la extensión

Extensión Manifest V3 que intercepta el envío de mensajes en ChatGPT, Claude y
Gemini, detecta secretos y PII **dentro de la propia página** y ofrece
enmascarar, cancelar o enviar igualmente.

---

## Antes de instalar: qué hace y qué no

**La detección es local.** El borrador no sale de la pestaña. La versión anterior
enviaba lo que escribías al servidor en cada pulsación de tecla; eso se eliminó.

**El servidor no es necesario.** La extensión protege aunque el gateway esté
apagado. El reporte de incidencias al gateway es opcional, está desactivado por
defecto, y cuando se activa envía solo el identificador de la regla y tu
decisión — nunca el texto.

**Se puede evitar.** Engancha el editor y el botón de envío visibles. Un
rediseño del sitio puede romperla, y siempre puede existir una vía de envío que
no conozca (un atajo propio del sitio, arrastrar y soltar, subir un archivo). No
cubre la aplicación de escritorio, el móvil ni otro navegador. Sirve para el
pegado accidental; no es un control que no se pueda evitar.

---

## Instalación

### Modo desarrollador (uso personal)

1. Abre el gestor de extensiones: `chrome://extensions/` (Chrome, Brave, Opera)
   o `edge://extensions/` (Edge).
2. Activa **Modo de desarrollador** (interruptor arriba a la derecha).
3. Pulsa **Cargar descomprimida** y selecciona el directorio `extension/` de
   este repositorio.
4. La extensión aparece en la lista. Ánclala a la barra para ver el estado.

### Despliegue en una organización

El modo desarrollador está deshabilitado por política en la mayoría de flotas
gestionadas, así que ese camino **no sirve para una empresa**. Las dos vías
reales:

- **Chrome Web Store**, con distribución privada al dominio de la organización.
  Requiere cuenta de desarrollador, revisión y una justificación de los permisos.
- **Instalación forzada por política** (`ExtensionInstallForcelist` vía GPO,
  Intune o Google Admin), que aun así exige que el paquete esté alojado en la
  Web Store o en un servidor de actualizaciones propio.

Ninguna de las dos está preparada todavía en este repositorio.

---

## Configuración

Pulsa el icono de la extensión:

| Ajuste | Efecto |
| :-- | :-- |
| **Reportar incidencias al gateway** | Desactivado por defecto. Al activarlo, envía identificador de regla y decisión a `/api/extension/event`. |
| **URL del gateway** | Por defecto `http://localhost:3000`. |

Si el gateway tiene autenticación activada, la extensión necesita una clave de
API. Guárdala desde la consola de la extensión:

```js
chrome.storage.local.set({ apiKey: 'tu-clave-de-api' })
```

Además, el origen de la extensión debe estar en la lista blanca CORS del
gateway. Añádelo a `.env`:

```bash
SYNAPSE_CORS_ORIGINS=http://localhost:3000,chrome-extension://<id-de-tu-extension>
```

El identificador aparece en la ficha de la extensión en `chrome://extensions/`.

---

## Comprobar que funciona

1. Abre `https://chatgpt.com`.
2. Escribe un texto con un secreto de prueba, por ejemplo:
   `mi clave es sk-proj-abcdefghijklmnopqrstuvwxyz123456`
3. Pulsa Enter. Debe aparecer un diálogo antes de que el mensaje se envíe.
4. **Enmascarar y enviar** sustituye el valor en el editor y continúa el envío.

Si el diálogo no aparece, revisa la consola de la pestaña: los content scripts
registran los errores ahí.

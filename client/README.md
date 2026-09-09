# Cliente

## `frontend/` — prototipo React sin conectar

Este directorio contiene una segunda interfaz que **no sirve el servidor**. El
panel activo es `public/`, servido por Express en `http://localhost:3000`.

Esta versión apunta a formas de API anteriores a la reescritura de 2026 y no
funcionará contra el gateway actual sin adaptarla. Su comentario de cabecera
afirma «100% Real API integration - Zero mock» sobre un backend que entonces
fabricaba las respuestas; se conserva como advertencia y como material
reutilizable, no como código en uso.

Antes de invertir tiempo aquí: decide qué interfaz sobrevive y borra la otra.
Mantener dos paneles que divergen es peor que tener uno mediocre.

## `dlp/`, `zk/` — prototipos

Ver [`../docs/EXPERIMENTAL.md`](../docs/EXPERIMENTAL.md).

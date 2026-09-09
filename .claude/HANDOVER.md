# Handover / Relevo para Claude

Consulta el reporte completo generado tras la auditoría y análisis de interfaces:
👉 [`docs/HANDOVER_CLAUDE.md`](../docs/HANDOVER_CLAUDE.md)
👉 [`docs/FIELD_TESTS_AND_INGESTION_ANALYSIS.md`](../docs/FIELD_TESTS_AND_INGESTION_ANALYSIS.md)

### Resumen Rápido:
- **Interfaces:** Confirmado que `public/` es la única activa y unificada. `client/frontend` permanece desvinculada en `.gitignore`.
- **Pruebas de campo:** Se identificaron las 4 variables de `.env` que el operador debe configurar para salir del mock (`OPENAI_API_KEY`, `SYNAPSE_VAULT_KEY`, `SYNAPSE_AUDIT_HMAC_KEY`, `SYNAPSE_DISABLE_AUTH=false`).
- **Ingestión Markdown:** Diseñado el flujo de conversión a Markdown (Ofimática $\to$ DLP $\to$ Contexto/MemoryHub) para optimizar el consumo de tokens y atención de los modelos.

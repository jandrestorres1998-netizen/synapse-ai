# Auditoría de Interfaces, Pruebas de Campo e Ingestión Markdown

**Fecha:** 9 de septiembre de 2026  
**Contexto:** Revisión posterior a la auditoría técnica y reconstrucción del Gateway SynapseAI.

---

## 1. Estado y Diagnóstico de Interfaces de Usuario

### ¿Están todas las interfaces en una sola?
**No.** Actualmente coexisten tres superficies de usuario diferenciadas en el árbol de trabajo:

```
SynapseAI/
├── public/              ← [ACTIVA Y UNIFICADA] Panel de Control servido por Express en :3000
├── client/frontend/     ← [DESCONECTADA] Dashboard React + Tailwind ("Cyber-Obsidian")
└── extension/           ← [COMPLEMENTARIA] Extensión Web Manifest V3 para navegadores
```

### Detalle por interfaz:

1. **`public/` (Panel de Control Oficial - Vanilla JS / CSS Modular):**
   - **Estado:** 100% activa, funcional y servida por Express en `http://localhost:3000`.
   - **Unificación:** Agrupa todas las funciones del operador en una sola SPA sin recargas:
     - `Probar`: Playground en vivo con trazado paso a paso del pipeline real (Inyección $\to$ DLP Ingress $\to$ Contexto $\to$ Caché $\to$ Smart Router $\to$ Inferencia $\to$ DLP Egress).
     - `Actividad`: Telemetría operativa, latencia p50/p95, peticiones totales y desglose de costes reales en USD.
     - `Protección`: Registro SIEM con hashes de correlación SHA-256 (sin exponer texto plano) y exportador JSONL/CSV.
     - `Contexto`: Gestor de directrices y memorias corporativas inyectadas en las llamadas.
     - `Ajustes`: Configuración en caliente de credenciales en la Bóveda (Vault), topes de presupuesto y snippets SDK.
   - **Seguridad:** Usa `sessionStorage` para no persistir credenciales de sesión en disco y soporta streaming SSE.

2. **`client/frontend/` (Dashboard React / Vite / Tailwind):**
   - **Estado:** Desconectada. Express no la sirve ni la compila.
   - **Divergencias técnicas con el backend actual:**
     - El cliente `synapseApi.js` no envía la cabecera `Authorization: Bearer <key>`. Con autenticación activa (`SYNAPSE_DISABLE_AUTH=false`), todas las peticiones retornan `401 Unauthorized`.
     - Falta la pantalla de `Ajustes` (gestión de llaves del Vault y límites de presupuesto diario/mensual).
     - CORS en el servidor bloquea peticiones desde `http://localhost:5173` salvo que se añada a `SYNAPSE_CORS_ORIGINS`.
   - **Recomendación:** Mantener `public/` como el panel canónico para evitar mantener dos paneles divergentes.

3. **`extension/` (Extensión Chromium Manifest V3):**
   - **Estado:** Operativa para interceptar fugas de datos directamente en aplicaciones web como ChatGPT o Claude Web.
   - **Conexión:** Se comunica con `/api/extension/event` bajo el ámbito `report:<key>`.

---

## 2. Requisitos y Brechas para Pruebas de Campo Reales

Actualmente el gateway ejecuta pruebas locales con el proveedor `mock` (`SYNAPSE_ALLOW_MOCK_PROVIDER=true`). Para habilitar pruebas de campo con tráfico real e inferencia de modelos en producción, se identificaron los siguientes puntos:

### A. Proveedores de Inferencia
- **Situación actual:** `/healthz` reporta estado `degraded` con `mockProviderActive: true`.
- **Acción requerida:** Configurar al menos una clave real en `.env` o en el Vault:
  - OpenAI (`OPENAI_API_KEY`)
  - Anthropic (`ANTHROPIC_API_KEY`)
  - Google Gemini (`GOOGLE_API_KEY`)
  - O levantar un nodo local de Ollama (`OLLAMA_BASE_URL=http://127.0.0.1:11434`).
  - Establecer `SYNAPSE_ALLOW_MOCK_PROVIDER=false` para evitar respuestas simuladas.

### B. Bóveda de Claves (SecureVault)
- **Situación actual:** El servidor advierte que opera en modo `"machine"`, derivando la clave de identificadores locales del SO.
- **Acción requerida:** Generar y configurar `SYNAPSE_VAULT_KEY` (mínimo 32 caracteres criptográficos) para cifrado AES-256-GCM real en reposo.

### C. Autenticación y Control de Acceso por Ámbitos
- **Situación actual:** `SYNAPSE_DISABLE_AUTH=true` en desarrollo.
- **Acción requerida:** Poner `SYNAPSE_DISABLE_AUTH=false` y emitir claves con ámbito en `SYNAPSE_API_KEYS`:
  - `master_admin_key`: Acceso total (Panel web, auditoría, Vault).
  - `inference:app_client_key`: Acceso exclusivo a `/v1/chat/completions` para las apps clientes.
  - `report:ext_worker_key`: Acceso exclusivo a telemetría de la extensión.

### D. Firma Criptográfica del Libro Mayor (AuditLedger)
- **Acción requerida:** Configurar `SYNAPSE_AUDIT_HMAC_KEY` para garantizar la inmutabilidad y autenticidad del archivo `data/audit-ledger.jsonl`.

### E. Rotación de Credencial de Licenciamiento
- **Alerta detectada:** La clave `data/keys/vendor_private.pem` estuvo en el árbol del proyecto y debe considerarse comprometida antes de distribuir cualquier binario.

---

## 3. Análisis de Ingestión y Conversión a Markdown

### ¿Es verdad que las IA procesan Markdown más rápido y con mayor precisión?
**Sí.** El fundamento es puramente arquitectónico y matemático en los Transformers:
1. **Densidad de Tokens:** Formatos binarios (PDF, DOCX) o estructurados verborrágicos (HTML, XML, JSON anidado) gastan del 30% al 60% de los tokens en sintaxis no semántica (`</div>`, llaves, atributos). Markdown minimiza los tokens requeridos para la misma información.
2. **Jerarquía Semántica en los Mecanismos de Atención:** Los LLMs modernos (GPT-4o, Claude 3.5, Gemini 1.5, Llama 3) fueron pre-entrenados intensivamente en código y repositorios Markdown. Los encabezados (`#`, `##`), listas (`-`) y tablas (`|`) orientan los *attention heads* hacia la estructura del documento.
3. **Tablas Estructuradas:** A diferencia del texto plano extraído de un PDF (que suele colapsar columnas en renglones inconexos), el formato tabla Markdown conserva la relación bidimensional fila-columna.

### Matriz de Viabilidad Técnica para SynapseAI:

| Tipo de Recurso | Nivel de Complejidad | Enfoque de Implementación | Estado en el Pipeline |
| :--- | :--- | :--- | :--- |
| **Documentos Ofimáticos** (`.pdf`, `.docx`, `.xlsx`, `.pptx`, `.csv`, `.txt`) | **Baja** | Librerías Node.js ligeras (`unpdf`, `mammoth`, `xlsx`, `turndown`) o microservicio de ingestión (Microsoft `MarkItDown`). | Se convierte a Markdown $\to$ pasa por DLP $\to$ se inyecta en `MemoryHub` o prompt. |
| **Imágenes / Escaneos** (`.png`, `.jpg`, `.webp`) | **Media** | OCR local (Tesseract) o inferencia VLM rápida (Gemini Flash / GPT-4o-mini). | Extracción estructurada antes del escaneo DLP. |
| **Audio** (`.mp3`, `.wav`, `.m4a`) | **Media - Alta** | Speech-to-Text con OpenAI Whisper API o Whisper.cpp local. | Transcripción $\to$ Markdown $\to$ DLP. |
| **Video** (`.mp4`) | **Alta** | Desacoplado: Extracción de audio + muestreo de keyframes. | No recomendado en el proceso síncrono del gateway. |

### Arquitectura de Ingestión Recomendada para SynapseAI:
Crear una ruta en el gateway:
- `POST /api/convert/markdown`: Acepta subida de archivos binarios, extrae texto estructurado en Markdown, ejecuta el escaneo DLP para censurar secretos/PII y devuelve el contenido sanitizado.
- Integración en la pestaña `Contexto`: Permitir arrastrar PDFs corporativos directamente a la interfaz para generar directrices de memoria automáticamente.

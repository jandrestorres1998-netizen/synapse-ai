# Modelo de amenazas

Este documento dice qué defiende SynapseAI y, con más detalle, qué **no**
defiende. La segunda parte es la que importa: un producto de seguridad que solo
enumera sus virtudes obliga al comprador a descubrir los huecos en producción.

---

## Contra qué protege

**T1 · Pegado accidental de secretos.** Una persona pega una clave de API, un
número de tarjeta o un DNI en un prompt. El motor DLP lo detecta por patrón y
checksum y lo enmascara antes de que salga hacia el proveedor. Es el caso de uso
principal y el que mejor cubre.

**T2 · Credenciales de proveedor repartidas por las aplicaciones.** Sin gateway,
cada aplicación guarda su copia de la clave de OpenAI. Con gateway, la clave vive
en un sitio, cifrada, y las aplicaciones reciben un token propio que puede
revocarse sin tocar la credencial real.

**T3 · Falta de trazabilidad.** Sin un punto de paso común no hay registro de qué
se envió a qué modelo. La cadena de auditoría lo proporciona, con las
limitaciones de la sección siguiente.

**T4 · Jailbreaks copiados y pegados.** Los patrones conocidos de sobreescritura
de instrucciones se bloquean antes de llegar al modelo.

**T5 · Filtrado de la salida.** Si el modelo devuelve un secreto —porque estaba
en su contexto o porque lo alucinó con formato válido— se enmascara antes de
llegar al cliente, también en streaming.

---

## Contra qué NO protege

**N1 · Un empleado decidido.** Quien quiera sacar datos de la empresa puede
copiarlos a su móvil, a su correo personal o a un servicio que el gateway no
conoce. Esto frena errores, no intenciones.

**N2 · Confidencialidad no estructurada.** El DLP reconoce cosas con forma:
`sk-…`, dieciséis dígitos que pasan Luhn, un IBAN con MOD-97 válido. Un párrafo
que describe la estrategia de precios del próximo trimestre pasa intacto y
siempre pasará. Ninguna expresión regular resuelve ese problema.

**N3 · Prompt injection en serio.** El filtro son cuatro patrones. Detiene
`"ignore all previous instructions"`. No detiene a alguien que reformule con
intención, ni la inyección indirecta a través de un documento que el modelo lee.
Esa clase de ataque no está resuelta en el estado del arte; aquí tampoco.

**N4 · Un operador adversario.** La cadena de auditoría se genera y se almacena
en la máquina auditada. Quien controle el proceso puede recalcularla entera. Con
`SYNAPSE_AUDIT_HMAC_KEY` guardada fuera del equipo, un atacante que pueda
reescribir el archivo pero no leer la clave no puede falsificar la cadena — pero
uno que controle el proceso en el momento de la escritura, sí. Para garantías
frente al propio operador hay que enviar el registro a un almacén externo de solo
adición.

**N5 · Evasión del canal por la extensión.** La extensión engancha el editor y el
botón de envío. Un rediseño del sitio la rompe, y siempre puede existir una vía
que no conozca (atajo propio, arrastrar y soltar, subida de archivo, otro
navegador, la aplicación de escritorio, el móvil). Es un cinturón de seguridad
para el descuido, no un control que no se pueda evitar. El control real vive en
la red o en la política de navegador gestionado.

**N6 · Elusión de licencia.** Verificación de firma offline sobre hardware del
cliente. Se puede parchear. Disuade el uso compartido casual y nada más.

**N7 · Robo del propio gateway.** Aquí está la contrapartida honesta de T2 y T3:
el gateway concentra las credenciales de todos los proveedores y el historial de
prompts de la organización en un proceso. Es un objetivo más valioso que
cualquiera de las aplicaciones que protege. Quien lo comprometa obtiene ambas
cosas a la vez. Si esa concentración no se compensa con un endurecimiento
proporcional —red aislada, claves rotadas, acceso restringido, copias cifradas—
el sistema empeora la postura de seguridad en lugar de mejorarla.

---

## Configuración obligatoria en producción

El arranque **falla** si falta cualquiera de estas:

| Requisito | Motivo |
| :-- | :-- |
| `SYNAPSE_API_KEYS` con claves de 32+ caracteres | Sin ella la API queda abierta a cualquier proceso local y a cualquier página web del navegador del usuario. |
| `SYNAPSE_DISABLE_AUTH` desactivado | Existe solo para instalaciones locales de una persona. |
| `SYNAPSE_CORS_ORIGINS` sin `*` | Un origen comodín permite a cualquier web usar el gateway con las credenciales del operador. |
| `SYNAPSE_ALLOW_MOCK_PROVIDER` desactivado | El proveedor mock devuelve texto sintético. En producción sería una respuesta falsa presentada como inferencia. |

Muy recomendables, con aviso en cada arranque si faltan:

| Recomendación | Motivo |
| :-- | :-- |
| `SYNAPSE_VAULT_KEY` | Sin ella el vault usa una clave derivada del `hostname`, la plataforma, la arquitectura, el modelo de CPU y el directorio home. Nada de eso es secreto: quien lea el archivo puede derivar la clave. |
| `SYNAPSE_AUDIT_HMAC_KEY` guardada fuera del equipo | Convierte la cadena de integridad en cadena autenticada. |
| Rotar el par de claves de vendedor | Si `data/keys/vendor_private.pem` estuvo alguna vez en el árbol del proyecto, debe considerarse comprometido. |
| Escuchar solo en `127.0.0.1` o en una red privada | El gateway custodia credenciales; no debe estar expuesto a internet sin una capa delante. |

---

## Reportar una vulnerabilidad

No abras una incidencia pública. Escribe al mantenedor con los pasos para
reproducirla. Si toca el DLP, incluye el texto exacto que se coló: se convertirá
en un caso de prueba.

# Confer — Especificación de la API

Define todas las API entre el cliente y el servidor, y entre el servidor y los peers A2A.

## Convenciones generales

- Base URL: `https://{instance}/api`
- Codificación: JSON, UTF-8
- Formato de fecha y hora: ISO 8601, UTC (`2024-11-15T14:30:00Z`)
- Identificadores: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- Formato de error:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## Autenticación

- Cliente de usuario: `Authorization: Bearer <jwt_access_token>`
- TTL del access token: 15 minutos; TTL del refresh token: 90 días
- Los dos tokens se distinguen por la reivindicación `typ` (`access` / `refresh`) y **no son intercambiables**: la cabecera `Authorization` solo acepta `access`, y `POST /auth/refresh` solo acepta `refresh`. Antes solo se diferenciaban en `exp`, de modo que el refresh token era un pase de 90 días válido en cualquier endpoint autenticado y los 15 minutos del access token no servían de nada
- El refresh rota en cada uso y se coteja contra `sessions.refresh_token_hash`; si no coincide se considera una reutilización y toda la sesión se invalida. `sessions.expires_at` es el límite **absoluto** de la sesión: la rotación no lo prolonga
- Los tokens se guardan en el almacenamiento local del cliente, no en una cookie HTTP-only (el cliente es una aplicación de escritorio Tauri, donde no existe el equivalente de las cookies de mismo origen)

## API de cliente (la que usa el cliente de usuario)

### Autenticación

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` petición:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

Respuesta:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### Configuración del usuario y del Agente

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # si cada proveedor está configurado (devuelve solo booleanos, nunca la clave)
PUT    /api/v1/agents/me/llm-keys      # guarda cifradas las claves de API de los LLM
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # consulta al proveedor, en vivo, qué modelos ofrece
```

Los valores de `provider` salen del catálogo de proveedores de `@confer/shared` (`packages/shared/src/llm/catalog.ts`), más el servicio de herramientas `tavily`. El catálogo lo leen a la vez la pasarela, agent-runtime y el cliente: la base URL, la ruta de la lista de modelos y el modelo por defecto se escriben en ese único sitio, así que añadir un proveedor es tocar solo el catálogo.

`/models` reenvía la lista de modelos del propio proveedor y nunca devuelve una lista mantenida localmente:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// una lista vacía siempre lleva su motivo; los cuatro son distintos y cada uno pide un remedio distinto
{ "models": [], "error": "no_key" }        // ese proveedor aún no tiene clave configurada
{ "models": [], "error": "unauthorized" }  // el proveedor rechazó la clave (401/403)
{ "models": [], "error": "unreachable" }   // no se puede contactar con el proveedor, o devolvió otro error
{ "models": [], "error": "unsupported" }   // ese proveedor no ofrece un endpoint de lista de modelos
```

### Contactos / Agentes ajenos

```
GET    /api/v1/contacts                     # lista los contactos. Paginación: ?limit=&offset=
POST   /api/v1/contacts                     # añade un contacto
GET    /api/v1/contacts/{contact_id}        # detalle de un contacto (con su peer)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # modifica parcialmente alias / tags / pinned / muted (los campos ausentes no se borran)

POST   /api/v1/contacts/lookup              # busca por DID / dominio / nombre de usuario
```

`POST /api/v1/contacts/lookup` petición:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` devuelve `{ contacts, total }`. `limit` vale 50 por defecto con un máximo de 100, y `offset` vale 0; se ordena por `id` (ULID) de forma descendente, o sea lo más reciente primero — el orden es único y determinista, que es lo que impide que la ventana de offset se salte filas o las repita. `total` es el recuento completo, no el de esta página, y con él el cliente sabe que ha llegado al final. Un `limit` o un `offset` que no se puedan interpretar toman el valor por defecto en lugar de dar error.

Respuesta: la lista de Agentes candidatos encontrados. La búsqueda **guarda en `peer_agents`** los peers que descubre e incluye en cada candidato su `id` local (`peer_id`) — y es justamente ese `id` el que usa `POST /api/v1/contacts` para añadir el contacto. `POST /contacts` es idempotente: añadir dos veces el mismo peer devuelve el contacto que ya existe (`200`) en lugar de un error.

> Añadir un contacto es **el consentimiento con el que quien recibe autoriza al otro a consumir su Agente**: solo un peer añadido como contacto puede hacer que mi Agente responda (y gaste mi presupuesto de LLM). Los mensajes A2A de un peer no conectado quedan en suspenso como una solicitud de conexión pendiente de aprobación; véase «La puerta del consentimiento de conexión» en `03-protocol.md`.

```
POST   /api/v1/contacts/{contact_id}/policies   # fija las políticas permanentes (sustitución completa, semántica de PUT)
```

El cuerpo de `POST /contacts/{id}/policies` tiene la forma de tiempo de ejecución `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` y se escribe entero en `peer_contacts.policy_overrides_json`. **Semántica de fusión**: al decidir sobre una petición A2A entrante, esta anulación por contacto se superpone a la política del Agente — si `contact.default` está presente sustituye al valor por defecto del Agente, y `contact.rules` va delante de las reglas del Agente, así que se evalúa primero (una regla precisa por contacto gana a una regla general del Agente). Una anulación vacía `{}` es la identidad: la decisión coincide byte a byte con la que se tomaría sin anulación.

### Conversaciones

```
GET    /api/v1/conversations                       # lista mis conversaciones (para la pantalla de inicio)
POST   /api/v1/conversations                       # crea una conversación
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # paginación: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # envía un mensaje
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # recibe por SSE la respuesta del LLM en flujo

POST   /api/v1/conversations/{id}/participants     # añade un participante
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # marca como leído
```

`POST /api/v1/conversations/{id}/messages` petición:

```json
{
  "content_type": "text",
  "content": "¿Qué código de función usa el registro 0x40 del X100?",
  "in_reply_to": null,
  "via": "web"
}
```

Respuesta:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### Gestión de permisos

```
GET    /api/v1/permissions/pending               # peticiones L2/L3 pendientes
POST   /api/v1/permissions/{id}/decide           # aprobar o rechazar
GET    /api/v1/permissions/history               # historial
```

`POST /api/v1/permissions/{id}/decide` petición:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // alcance de la decisión
}
```

Entre las peticiones pendientes, las que tienen `action='connect'` son **solicitudes de conexión** (las genera la entrada A2A cuando un peer desconocido contacta por primera vez). Aprobarla (`allow_*`) escribe ese peer en `peer_contacts` y establece la conexión; rechazarla no.

Las que tienen `action='ask'` son **preguntas pendientes de un peer ya conectado**: las genera la entrada A2A cuando la política del Agente resuelve `ask_user` para esa pregunta (véase «Bandeja pendiente (respuesta en diferido)» en `03-protocol.md`). Aprobarla (`allow_*`) hace que el Agente responda a la pregunta en suspenso; rechazarla la deja sin responder.

`GET /pending` acompaña cada petición de una `description` (la solicitud de conexión lleva quién la inicia y su primer mensaje; la pregunta, quién la hace y su texto) para que el dueño pueda decidir.

### Memoria de proyecto (para la integración con Claude Code)

```
GET    /api/v1/projects/{project_id}/peers              # los peers con memoria en este proyecto (con name/did en el join)  ✅ implementado
POST   /api/v1/projects/{project_id}/peers              # registra un peer en el proyecto explícitamente   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implementado
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implementado
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implementado
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implementado
```

Notas de semántica (v0.1):

- Todas las consultas se limitan a `user.sub` (aislamiento entre usuarios).
- Antes de un PUT se comprueba que el peer sea contacto de ese usuario (`peer_contacts`); si no lo es, se devuelve `403 not_a_contact`.
- El PUT hace upsert: la primera escritura deja `version=1`, y cada siguiente incrementa `version` y actualiza `updated_at`. `facts` y `decisions` son independientes: escribir una sección no vacía la otra.
- `GET facts/decisions` devuelve `200` con una cadena vacía y `version:0` cuando ese par (proyecto, peer) todavía no tiene memoria (no un 404: «este peer aún no ha dejado nada» es un estado normal en lectura).
- `project_id` se valida contra `^[a-zA-Z0-9._\-/]+$` (de 1 a 255 caracteres); si no cumple se devuelve `400 invalid_project_id`.
- `GET peers` devuelve un array vacío en un proyecto sin nada. La relación (proyecto, peer) se crea implícitamente al hacer PUT de facts/decisions (en esta fase no hay registro explícito con `POST peers`).

### Base de conocimiento (RAG)

```
GET    /api/v1/knowledge-bases                                  # lista mis bases de conocimiento
POST   /api/v1/knowledge-bases                                  # crea una
PATCH  /api/v1/knowledge-bases/{kb_id}                          # cambia el nombre o la descripción, y si se abre a Agentes externos
DELETE /api/v1/knowledge-bases/{kb_id}                          # la borra junto con todos sus documentos y vectores

GET    /api/v1/knowledge-bases/{kb_id}/documents                # paginación: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # subida multipart, campo llamado file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # vuelve a indexar
```

El cuerpo de `POST /knowledge-bases` es `{ name, description? }` (`name` de 1 a 255 caracteres) y devuelve `201` con `{ knowledge_base }`.

El cuerpo de `PATCH /knowledge-bases/{kb_id}` es `{ name?, description?, shared_with_peers? }` y devuelve `{ knowledge_base }`. **`shared_with_peers` solo se puede cambiar aquí; al crear la base no se acepta**: toda base nace «solo para mí», y abrirla al exterior es un segundo acto deliberado.

Lo que decide `shared_with_peers` es **si una pregunta A2A entrante puede buscar en esa base**, y vale `false` por defecto. No afecta al dueño cuando conversa en la web: él siempre lo busca todo. Esta frontera tiene que caer sobre el alcance de la búsqueda y no sobre el prompt: la pregunta del otro y las instrucciones del dueño le llegan al modelo como el mismo tipo de texto, así que «que el Agente juzgue si debe contarlo» no constituye frontera alguna. Por lo mismo, una pregunta A2A entrante **no recupera ninguna memoria de largo plazo**: la memoria de largo plazo se destila de las conversaciones del propio dueño, y ni una sola de sus entradas está marcada como apta para salir de esta instancia.

`GET /knowledge-bases` devuelve `{ knowledge_bases }` y **no se pagina**: las bases de un usuario se crean a mano y su número está acotado.

`GET /{kb_id}/documents` devuelve `{ documents, total }`. `limit` vale 50 por defecto con un máximo de 100, y `offset` vale 0; se ordena por `id` (ULID) de forma descendente, o sea lo más reciente primero — un orden único y determinista es lo que impide que la ventana de offset se salte filas o las repita. `total` es el recuento completo, no el de esta página. Un `limit` o un `offset` ilegibles toman el valor por defecto en lugar de dar error. Esta es la única lista de esta sección que crece sin límite, porque la base de conocimiento es justamente el destino de las subidas.

La subida va por `multipart/form-data`, el campo del fichero se llama siempre `file` y cada fichero puede pesar como mucho **10 MB** (si se pasa, `400 bad_request`). El `Content-Type` se toma del formulario si viene y, si falta, se deduce de la extensión. La respuesta es `201` con `{ document }`, y para entonces `status` ya vale `processing`: **la segmentación, la vectorización y la escritura en Qdrant ocurren de forma asíncrona después de la respuesta**, el endpoint de subida no las espera. El cliente sondea la lista de documentos hasta que `status` cambie.

Valores de `status`:

| Valor | Significado |
|---|---|
| `processing` | Ya está guardado y se está segmentando o vectorizando. Es el estado inicial tras subir y tras un retry |
| `ready` | Se puede buscar en él. `chunk_count` es el número de fragmentos del documento |
| `failed` | La indexación falló (al analizarlo, por falta de clave de embedding o al escribir en la base vectorial) |

`POST /{doc_id}/retry` recupera el fichero original del almacenamiento de objetos y lo vuelve a indexar; antes borra los vectores que ese documento ya tenía, así que no se duplican fragmentos. Devuelve `400` si el fichero original ya no está (`storage_key` vacío) o si el documento sigue en `processing`. La respuesta es `{ document }`, con `status` de vuelta a `processing` y `chunk_count` a cero.

Borrar una base de conocimiento borra en cascada todas sus filas de documento y sus vectores en Qdrant; borrar un solo documento limpia además sus vectores y el fichero original en el almacenamiento de objetos. Que falle la limpieza de vectores o de objetos no impide el borrado en la base de datos: mejor dejar un objeto huérfano que una fila que apunta a datos ya borrados.

Todos los endpoints se limitan a `user.sub`: acceder a la base o al documento de otra persona devuelve `404` (y no `403`, para no revelar que existe).

> El proxy inverso tiene que dejar pasar cuerpos de 10 MB. `infra/nginx.conf` fija `client_max_body_size 10m` en `/api/`; con el valor por defecto de nginx, 1 MB, los ficheros de entre 1 y 10 MB no llegan siquiera a la pasarela y lo que ve el navegador es la página 413 de nginx.

### Adjuntos

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # descarga (302 a una URL firmada)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### Endpoint

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

La autenticación del handshake es idéntica a la de REST, no un «si la firma vale, que pase»: `typ` tiene que ser `access`, `sid` tiene que apuntar a una sesión que siga existiendo y la cuenta no puede estar `disabled`. Las tres cosas son imprescindibles: sin ellas, a una cuenta bloqueada le basta con que su token no haya caducado para reconectarse y seguir recibiendo mensajes, mientras que el bloqueo en sí (borrar todas sus sesiones) no revoca nada por esta vía. Bloquear a alguien **cierra también los sockets que ya tuviera abiertos**: nginx da a `/ws` un `proxy_read_timeout` de un día, y detener el siguiente handshake no detiene la conexión ya establecida.

### Formato de los mensajes

Todos los mensajes WS son JSON y llevan un campo `type`:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### Cliente → servidor

```
ping                          // latido
subscribe.conversation        // suscribirse a una conversación (el servidor comprueba que se es participante)
unsubscribe.conversation
typing.start                  // solo surte efecto en conversaciones ya suscritas
typing.stop
read.ack                      // confirmación de lectura
```

La difusión de `typing.*` se rige por el conjunto de suscripciones de ese socket. Cuando la suscripción tiene puerta y los eventos de escritura no, basta con conocer el id de una conversación para inyectar en ella un «fulano está escribiendo» — con el nombre de usuario de uno mismo, además.

### Servidor → cliente

```
pong
message.new                   // mensaje nuevo
message.updated
message.deleted
typing.update                 // quién está escribiendo
presence.update               // un contacto se conecta o se desconecta
permission.request            // una petición de permiso que el usuario debe decidir
agent.status                  // qué está haciendo mi Agente («consultando al Agente de ABC…»)
conversation.updated
```

`message.new` por ejemplo:

```json
{
  "type": "message.new",
  "data": {
    "id": "01HXKQ...",
    "conversation_id": "01HX...",
    "sender_type": "peer_agent",
    "sender_id": "01HY...",
    "sender_did": "did:web:acme.com:agents:support",
    "content_type": "text",
    "content": "Con 0x03, Read Holding Registers…",
    "citations": [
      {
        "source": "Manual de comunicaciones del X100 v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "es",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` por ejemplo:

```json
{
  "type": "permission.request",
  "data": {
    "id": "01HXP...",
    "level": "L2",
    "action": "share_files",
    "scope": {
      "peer": "did:web:acme.com:agents:support",
      "paths": ["src/modbus/"],
      "exclude": [".env", "secrets/"]
    },
    "peer_name": "ABC Agent",
    "peer_did": "did:web:acme.com:agents:support",
    "requested_at": "2024-11-15T14:30:00Z"
  }
}
```

**En la carga útil no hay `description`, y es a propósito.** El servidor no sabe en qué idioma lee quien recibe, así que solo envía hechos estructurados (`action` + la identidad del peer + el `scope` almacenado), y la frase que se lee al aprobar la compone el cliente según su i18n (`packages/client/src/lib/permission-text.ts`). Este contrato pertenece en exclusiva a `permissionRequestEventSchema`, en `@confer/shared`: la pasarela lo usa para parsear antes de enviar y el cliente para parsear al recibir.

Cada fila de `GET /api/v1/permissions/pending` tiene esa misma forma (con un campo `decision` de más) y sale del mismo constructor, de modo que la fila que llega por sondeo y la que empuja el socket coinciden byte a byte.

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

Tipos de evento:

```
event: token
data: {"text":"Con "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"Manual de comunicaciones del X100 v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## API A2A (hacia fuera, para que la llamen otras instancias de Confer)

Véase `docs/03-protocol.md`. Aquí solo se enumeran los endpoints.

Dos vinculaciones conviven bajo el mismo prefijo y comparten las mismas puertas (`a2a/inbound.ts`); lo único que cambia es el formato de cable.

**Vinculación HTTP+JSON estándar de A2A** (las rutas están copiadas tal cual de la §11.3 de la especificación, y es la que anuncia la Agent Card):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks (paginación por cursor)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # sin implementar → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # sin implementar → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # sin implementar → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**El dialecto propio de Confer** (para hablar entre instancias; se descubre por `/.well-known/agents.json`):

```
POST   /a2a/v1/messages                  # recibe mensajes de Agentes externos
GET    /a2a/v1/stream/{message_id}       # recoge la respuesta en flujo (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # AgentFacts público
```

Todos los endpoints A2A exigen verificación de la firma HTTP del mensaje.

## .well-known endpoints

```
GET    /.well-known/did.json                # documento DID principal
GET    /.well-known/agents.json             # lista de todos los Agentes públicos de esta instancia
GET    /.well-known/agent-card.json         # Agent Card estándar de A2A (solo si la instancia tiene un único Agente público)
GET    /.well-known/openid-configuration    # a futuro: compatibilidad OIDC (v2)
```

## Agent Card estándar de A2A (capa de descubrimiento interoperable)

```
GET    /agents/{username}/agent-card.json   # la Card estándar A2A de ese Agente
GET    /.well-known/agent-card.json         # lo mismo, solo si esta instancia tiene un único Agente público
```

Sigue el `AgentCard` de **Agent2Agent v1.0** de la Linux Foundation (los campos salen de `specification/a2a.proto` de `a2aproject/A2A` @ v1.0.1 y usan el mapeo JSON de proto3, de ahí el camelCase). Su fin es que el ecosistema A2A **descubra** a los Agentes de esta instancia: los nombres coincidían pero los protocolos no se entendían, porque el documento de descubrimiento del otro lado está en `/.well-known/agent-card.json` y esta instancia solo tenía `/.well-known/agents.json`.

Algunas decisiones deliberadas:

- **Una Card por Agente**, con `supportedInterfaces[].tenant` = nombre de usuario. El well-known de la especificación da por supuesto un Agente por dominio, y esta instancia es multiinquilino; `tenant` es precisamente el selector de enrutado que la especificación define para «varios Agentes detrás de un mismo endpoint A2A». `/.well-known/agent-card.json` solo responde cuando hay **exactamente un Agente público** (el caso de quien se autoaloja en solitario); si no, devuelve 404 y en el mensaje de error apunta a `agents.json` — elegir una cuenta cualquiera y llamarla «el Agente de este dominio» sería sencillamente falso.
- **`streaming: false`**. Endpoints en flujo sí que hay, pero con la forma propia de Confer, no con el `SendStreamingMessage` de la especificación. Anunciar una capacidad que un cliente estándar no puede usar es peor que no anunciarla.
- **No se declara `securitySchemes`**. Lo que la especificación ofrece ahí es clave de API, autenticación HTTP, OAuth2, OIDC o mTLS, y este endpoint no acepta ninguno: lo que quiere es una petición firmada. Rellenar uno cualquiera equivaldría a decirle al cliente que puede autenticarse de una forma que se va a rechazar sin falta. El requisito real se declara como **extensión obligatoria** (`capabilities.extensions`, con la dirección de la RFC 9421 en `uri` y `required: true`), que es justo el mecanismo que la especificación prevé para esto.
- La Card es un **documento de descubrimiento** y su visibilidad es idéntica a la de `/.well-known/agents.json`: un Agente no público o dado de baja devuelve 404 siempre; de lo contrario esta ruta se convertiría en una manera de enumerar cuentas que su dueño no quiso hacer públicas.

- **Se anuncia una sola vinculación.** El dialecto propio de Confer vive en esta misma URL, pero no se escribe en la Card: la §5.1 exige que todas las vinculaciones que un Agente declare sean funcionalmente equivalentes, y el dialecto no tiene ciclo de vida de tareas. Se descubre por `/.well-known/agents.json`, y así la Card no promete nada que no pueda cumplir.

### Capa de mensajes (semántica de Task)

`POST /a2a/v1/message:send` recibe el `SendMessageRequest` de la especificación y devuelve un `Task`. **Una tarea es una pregunta entrante**: su `id` es el id de ese mensaje, su `contextId` es la conversación donde se archiva, y su estado se deduce de lo que ocurre después — no hay una tabla `tasks` aparte que sea la sombra del mismo hecho.

El modelo asíncrono de Confer, con su puerta de consentimiento, encaja exactamente en la máquina de estados de la especificación:

| Situación | Estado |
|---|---|
| El Agente está respondiendo | `TASK_STATE_WORKING` |
| Ha terminado | `TASK_STATE_COMPLETED` |
| Este turno no puede ni arrancar (sin modelo configurado, o el proveedor falló) | `TASK_STATE_FAILED` |
| En suspenso por la política `ask_user`, a la espera del dueño | `TASK_STATE_AUTH_REQUIRED` (estado de interrupción, no terminal) |
| El dueño lo rechazó | `TASK_STATE_REJECTED` |

Hay dos casos en los que **no** hay tarea que devolver, porque no se llegó a crear ninguna fila: el peer desconocido (que queda como solicitud de conexión pendiente) y el rechazo directo por política. Ambos responden `403 PERMISSION_DENIED` y se distinguen por `ErrorInfo.metadata.confer_status` — inventar un id de tarea que daría 404 en la siguiente llamada sería peor.

El resto del comportamiento se alinea punto por punto con la especificación: el cuerpo de error tiene la forma de `google.rpc.Status` y **siempre** lleva `ErrorInfo.reason` (varios errores A2A comparten el mismo código HTTP, y `reason` es el único campo que los distingue); a un cliente que no declare la extensión obligatoria se le responde con `ExtensionSupportRequiredError`, según la §3.3.4, y no con un 401 que no explica nada; `historyLength=0` significa **omitir el campo entero**, no mandar un array vacío; y `nextPageToken` está siempre presente, con cadena vacía cuando no hay página siguiente.

Dos desviaciones deliberadas, ambas anotadas en el código: la espera del `message:send` bloqueante **tiene tope** (55 s, tras los cuales se devuelve la tarea todavía en `WORKING` para que el cliente sondee) — la §3.2.2 no ofrece salida por tiempo, y una llamada a un LLM no tiene cota superior; y la idempotencia por `messageId` (un MAY de la §3.3.1) **no está hecha**, porque una clave única segura entre inquilinos necesita el ámbito del dueño y el formato de cable del primer mensaje no lo trae.

## Webhooks (opcional, v1.5+)

Permiten que sistemas externos se suscriban a eventos:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

Eventos admitidos: `message.new.peer`, `permission.granted`, `thread.archived`.

## Política de límite de tasa

| Ruta | Límite |
|---|---|
| `/api/v1/auth/login` | 10/minuto por IP |
| `/api/v1/auth/register` | 3/hora por IP |
| `/api/v1/conversations/*/messages` POST | 60/minuto por usuario |
| `/a2a/v1/*` | 100/minuto por dominio de peer (más si está en la lista blanca) |
| WSS | como mucho 10 conexiones simultáneas por usuario |

Respuesta al superar el límite:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## API de consulta (salida A2A iniciada por el usuario)

Permite que el usuario (o el servidor MCP que actúa en su nombre) pregunte por iniciativa propia a un Agente ajeno **que ya sea contacto suyo** y recoja después la respuesta asíncrona. La firma y la entrega ocurren enteras dentro de la pasarela; la clave privada no sale de ella.

> Diferencia con la «API de conversaciones»: `/api/v1/conversations` + `/api/v1/stream` es conversar con **el asistente LLM local de uno mismo**; `/api/v1/consult` es lo que se manda por A2A **al Agente de otra persona**.

### POST `/api/v1/consult/:peerId`

Inicia o continúa una conversación de `type='consult'` (cada peer reutiliza la misma), y firma y entrega un `message.type='question'`.

```jsonc
// cuerpo de la petición (consultRequestSchema)
{ "question": "¿Cómo se rotan las claves?", "code_context": "…código opcional…", "language": "es" }
```

| Respuesta | Significado |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | firmada y entregada |
| `502 { ..., status: "failed", error }` | falló la entrega (peer sin conexión, sin endpoint, o problema de firma) |
| `403 not_a_contact` | el peer no es contacto del usuario actual |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

Espera por sondeo largo la respuesta asíncrona del peer (que llega por la entrada `/a2a/v1/messages` con su `thread_id`, y la pasarela la vuelve a colgar del hilo correspondiente). El tope de `wait` es 55 s.

- `200 { status: "answered", message }` — ha llegado la respuesta
- `200 { status: "pending" }` — se agotó el tiempo sin respuesta; se puede volver a sondear más tarde

### GET `/api/v1/consult/:conversationId`

Devuelve el historial completo de ese hilo de consulta (200 mensajes como máximo).

> Contrato: la entrada A2A solo dispara la respuesta automática del Agente local para `message.type==='question'`; `answer` y `notification` se guardan y se difunden, y nada más, para que la respuesta a una consulta no desencadene un intercambio infinito.

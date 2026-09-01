# Confer — diseño del protocolo

Define todos los protocolos que hay entre instancias de Confer y entre el cliente del usuario y el servidor. Todos se apoyan en estándares abiertos, para facilitar la federación futura.

## Identidad del Agente

### Formato DID:web

Cada instancia de usuario o de empresa aloja su propio documento DID:

```
https://acme.com/.well-known/did.json
```

Estructura del documento DID (compatible con W3C DID v1.0):

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:acme.com",
  "verificationMethod": [
    {
      "id": "did:web:acme.com#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:acme.com",
      "publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSrue..."
    }
  ],
  "service": [
    {
      "id": "did:web:acme.com#confer-agent",
      "type": "ConferAgent",
      "serviceEndpoint": "https://acme.com/a2a/v1"
    }
  ]
}
```

El DID del Agente de un usuario tiene esta forma: `did:web:acme.com:agents:laowang` — la instancia principal más un segmento de ruta. Así una sola instancia puede alojar a varios usuarios.

Según la especificación de did:web, un **DID con subidentificador** (es decir, con segmentos de ruta) se resuelve al documento que corresponde a esa ruta, **no** al `.well-known` de la raíz de la instancia:

- `did:web:acme.com:agents:laowang` → `https://acme.com/agents/laowang/did.json` (dos puntos → barra, y al final `/did.json`)
- El DID desnudo de la instancia, `did:web:acme.com` → `https://acme.com/.well-known/did.json`
- Un puerto real se codifica con `%3A`: `did:web:acme.com%3A3000:agents:laowang` → `https://acme.com:3000/agents/laowang/did.json` (unos dos puntos desnudos como `:8080` son un segmento de ruta, no un puerto)

### Rotación de claves

- El documento DID admite declarar varios métodos de verificación, para rotar sin interrupciones.
- La clave antigua se conserva al menos 30 días (para que no fallen las peticiones en vuelo).
- La revocación se hace quitando el método de verificación del documento.

## AgentFacts (compatible con NANDA)

Cada Agente publica un AgentFacts que lo describe. Ubicación:

```
https://acme.com/agents/{slug}/agent.json
```

O el directorio general en well-known:

```
https://acme.com/.well-known/agents.json
```

Ejemplo de estructura:

```json
{
  "@context": "https://nanda.dev/schemas/agent/v1",
  "did": "did:web:acme.com:agents:support",
  "name": "ABC Industries Support Agent",
  "description": "Technical support for X100, X200 industrial controllers",
  "owner": {
    "type": "Organization",
    "name": "ABC Industries Ltd.",
    "url": "https://acme.com"
  },
  "capabilities": [
    {
      "type": "qa",
      "scope": ["X100", "X200", "Modbus", "RTU", "TCP"],
      "languages": ["en", "zh", "de"]
    },
    {
      "type": "code-generation",
      "scope": ["python", "c", "embedded"],
      "languages": ["en", "zh"]
    }
  ],
  "endpoints": {
    "a2a": "https://acme.com/a2a/v1",
    "stream": "https://acme.com/a2a/v1/stream"
  },
  "trust": {
    "verifiedBy": ["did:web:nanda.org"],
    "issuedAt": "2024-10-01T00:00:00Z"
  },
  "publicKey": {
    "id": "did:web:acme.com#key-1",
    "type": "Ed25519VerificationKey2020"
  }
}
```

Los campos:

- `capabilities`: declara qué sabe hacer este Agente. Claude Code usa el campo `scope` para encaminar por palabras clave (al escribir código relacionado con el X100, consulta automáticamente a este Agente).
- `languages`: los idiomas admitidos. Se usa para la estrategia de traducción.
- `trust.verifiedBy`: aval de confianza de un tercero (opcional; NANDA lo proveerá en el futuro).
- `publicKey`: la clave pública de firma para la comunicación A2A.

## Protocolo A2A

### La capa de protocolo

Toda la comunicación A2A va por HTTPS POST/GET, codificada en JSON. Bajo `/a2a/v1` conviven dos enlaces:

- **El enlace HTTP+JSON de A2A v1.0 de la Linux Foundation** (`routes/a2a-rest.ts`), con las rutas tal cual las define §11.3 de la especificación: `POST /message:send`, `GET /tasks/{id}`, etc. Es el que anuncia la Agent Card y el que llaman los clientes estándar. Véase `docs/05-api.md`.
- **El dialecto propio de Confer** (`routes/a2a.ts`), usado entre instancias y descubierto a través de `/.well-known/agents.json`.

Ambos comparten exactamente las mismas compuertas —verificación de firma, compuerta de consentimiento, decisión de política, pertenencia del hilo—, todas en `a2a/inbound.ts`; solo cambia el formato de cable. **Escribir esas compuertas una vez por enlace es la razón de que el fallo de inyección de hilos entre inquilinos se escribiera cuatro veces**; no las separe otra vez.

**Lo esencial: se usan HTTP Message Signatures (RFC 9421), no un bearer token.** Los motivos:

- Un bearer token queda comprometido en cuanto lo interceptan.
- Una firma HTTP está ligada a una petición concreta (método + ruta + query + digest del cuerpo + marca temporal).
- Contra el reenvío: la cabecera `Date` de la petición debe caer dentro de una ventana de 5 minutos, y cada firma verificada se anota en una caché de reenvío (nonce), de modo que reenviar la misma petición dentro de la ventana se rechaza; verificar la firma basta para confirmar quién envía.

**Los componentes que cubre la firma** son `@method`, `@authority` y `@path`, más `@query` cuando la petición lleva cadena de consulta y `content-digest` cuando lleva cuerpo, más `date`. `@query` no es un refinamiento opcional: `@path` se detiene en el `?`, y el `GET /tasks` del enlace REST filtra y pagina enteramente con parámetros de consulta; no cubrirlos equivale a dejar que un intermediario los reescriba a su gusto con la firma todavía válida. Los parámetros de la firma incluyen además un `nonce` aleatorio por petición: `created` solo tiene granularidad de segundos, así que dos peticiones idénticas en el mismo segundo firmarían los mismos bytes y la caché de reenvío del receptor las tomaría por un ataque (cualquier sondeo de una tarea, o cualquier reintento, choca con esto). Un reenvío de verdad —los mismos bytes reenviados tal cual— sigue detectándose, porque la firma sigue siendo idéntica byte a byte.

**Esta capa no tiene los `securitySchemes` de la especificación**: aquello son claves de API, autenticación HTTP, OAuth2, OIDC o mTLS, y ninguno es una firma de petición. El requisito real se declara en la Card como una **extensión obligatoria**, y el enlace REST la impone según §3.3.4: un cliente que no declare esa extensión recibe `ExtensionSupportRequiredError`, en lugar de un 401 que no explica nada.

### Ejemplo de petición entrante

```http
POST /a2a/v1/messages HTTP/1.1
Host: acme.com
Content-Type: application/json
Date: Sun, 24 Nov 2024 14:30:00 GMT
Content-Digest: sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:
Signature-Input: sig1=("@method" "@authority" "@path" "content-digest" "date");keyid="did:web:vendor-x.com#key-1";created=1732458600;alg="ed25519"
Signature: sig1=:aBcDeF...:
Authorization: Capability eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiQ2FwIn0...

{
  "from": "did:web:vendor-x.com:agents:engineer-li",
  "to": "did:web:acme.com:agents:support",
  "thread_id": "thread_8f3a9c",
  "message": {
    "type": "question",
    "content": "¿Cuál es el rango de tensión del X100 en modo RTU?",
    "language": "es",
    "context": {
      "via": "claude-code",
      "project_hint": "modbus integration"
    }
  }
}
```

### Flujo de verificación (en el receptor)

1. Analizar las cabeceras `Signature-Input` y `Signature`.
2. Extraer el DID del parámetro `keyid` de `Signature-Input`.
3. Recuperar el documento DID (con caché: ETag + TTL de 60 s).
4. Sacar la clave pública, reconstruir la cadena base de la firma según RFC 9421 §2.5 y verificar la firma.
5. Comprobar que `Content-Digest` coincide con el hash del cuerpo.
6. Comprobar que `Date` está dentro de 5 minutos (contra el reenvío).
7. Verificar el token de capacidad (estilo macaroon, detallado más abajo).
8. **Compuerta de consentimiento de la conexión**: ¿el remitente está ya entre los contactos del receptor? Si no lo está → no se ejecuta el LLM; queda en espera como solicitud de conexión (véase más abajo).
9. Si lo está → pasa al motor de políticas, que decide si responder.

### Token de capacidad

El token de capacidad permite al Agente remitente declarar «vengo en nombre del usuario X a preguntar algo del tipo Y», y limita los permisos con grano fino.

Al estilo de un JWT, pero con la idea de las macaroons:

```json
{
  "iss": "did:web:vendor-x.com",
  "sub": "did:web:vendor-x.com:users:engineer-li",
  "aud": "did:web:acme.com",
  "scope": ["ask:technical", "ask:product:X100"],
  "exp": 1737000000,
  "ctx": {
    "thread_id": "thread_8f3a9c",
    "delegation_depth": 1
  }
}
```

- `scope`: qué tipo de preguntas puede hacer.
- `delegation_depth`: cuántas veces se ha reenviado por delegación (para evitar una cadena infinita).

### Respuesta en flujo

El LLM genera la respuesta en flujo, y A2A también admite SSE:

```http
GET /a2a/v1/stream/{message_id} HTTP/1.1
Host: acme.com
Signature: ...
```

Devuelve `text/event-stream`:

```
event: token
data: {"text": "El X100 "}

event: token
data: {"text": "en modo RTU "}

event: citation
data: {"source": "Manual de instalación del X100 p.12", "url": "..."}

event: done
data: {"thread_id": "thread_8f3a9c"}
```

## Modelo de permisos (inspirado en Claude Code)

Tres niveles:

### L1 — automático (sin confirmar)

- Mi Agente lee mis propios datos.
- El Agente de la otra parte responde citando sus propios documentos.
- Conversación entre Agentes puramente consultiva (sin efectos secundarios ni datos compartidos).

### L2 — preguntar una vez

- Compartir un directorio o archivo con el Agente de la otra parte.
- Dejar que el Agente ajeno vea el contexto de mi conversación.
- Reenviar datos a otra instancia.
- Activar una herramienta (la primera vez).

En la interfaz: aparece una tarjeta de permiso con cuatro opciones:
- Permitir esta vez
- Permitir siempre (limitado a ese peer y ese alcance)
- Ver detalles
- Denegar

### L3 — consentimiento explícito (se pregunta siempre)

- Que mi Agente acepte invitaciones, pague o firme contratos en mi nombre.
- Operaciones irreversibles (borrar, transferir, comprometerse frente a terceros).
- Compromisos con implicaciones económicas o legales.

En la interfaz: ventana modal + lista detallada de la operación + cuenta atrás (para evitar clics accidentales).

### Políticas permanentes

El usuario puede fijar reglas de antemano que anulen el comportamiento por defecto:

```yaml
peer.acme-industries:
  allow:
    - read: "src/modbus/**"
    - ask: "technical:*"
  deny:
    - read: ".env"
    - read: "**/secrets/**"
    - ask: "personal:*"
  always_consult: true

peer.unknown:
  default: ask_user
  require_human_in_loop: true
```

### Compuerta de consentimiento de la conexión

Responder a un mensaje A2A consume el presupuesto de LLM **del receptor**. Para que un Agente desconocido no pueda mandar mensajes sin freno y quemar los tokens de su dueño sin que este se entere, estar conectado es condición previa a ese gasto:

- **Peer ya conectado** (presente en los `peer_contacts` del receptor) → la conexión es el consentimiento; pasa al motor de políticas y se procesa con normalidad.
- **Peer no conectado** → `POST /a2a/v1/messages` devuelve `202` con el cuerpo `{ "status": "pending_connection" }`; **no se crea conversación, no se guarda el mensaje y no se ejecuta el LLM**. A la vez se deja en la bandeja de pendientes una solicitud de conexión con `action='connect'` (deduplicada por peer, para que los mensajes repetidos no la inunden).
- El dueño ve en su bandeja de permisos «tal Agente pide conectar + su primer mensaje». Si **aprueba**, se escribe en `peer_contacts` (la conexión queda hecha) y a partir de ahí los mensajes de ese peer se procesan con normalidad; si **deniega**, no se establece la conexión.

El modelo se parece al de LinkedIn o al de una federación de empresas: **capa de descubrimiento abierta** (cualquiera puede leer `agents.json` y los AgentFacts) y **capa de interacción con consentimiento** (solo se puede consumir cómputo ajeno tras conectar).

Hay dos caminos para llegar a estar «conectado»:
1. El receptor añade al peer por su cuenta, con `POST /contacts/lookup` → `POST /contacts`.
2. El peer toma la iniciativa y el receptor aprueba su solicitud desde la bandeja.

### Vinculación del hilo (el alcance de `thread_id`)

El `thread_id` de un mensaje entrante es una **petición** del peer, no una orden con autoridad. El gateway lo reutiliza **con su valor original** solo si se cumplen a la vez dos condiciones:

1. Ese peer ya es participante de esa conversación.
2. Esa conversación **pertenece al dueño del Agente al que se dirige el mensaje** (`conversations.created_by`).

La segunda no se puede omitir: `peer_agents` es único globalmente por DID, así que un mismo peer puede estar conectado con varios dueños a la vez. Si solo se comprobara la primera, un peer conectado con A y con B podría, al escribir al Agente de B, adjuntar el `thread_id` de A y verter el mensaje en la conversación de A: el Agente de B respondería tomando el historial de A como contexto, la respuesta se escribiría en el hilo de A y se difundiría a A, y encima el contenido de la conversación de A acabaría sedimentado en la memoria a largo plazo de B.

Que se cumplan las dos significa que la otra parte está respondiendo a un mensaje que salió de aquí (y entonces el `thread_id` es el id de nuestra propia conversación). Cuando no se cumplen, se trata de **un hilo en la numeración del propio peer**: aquí no apunta a nada, pero para el peer es estable, así que nuestro id de conversación se deriva de `sha256('a2a-thread:<id del dueño>:<id de la fila del peer>:<thread_id del peer>')` (`lib/derived-id.ts`, que devuelve 26 caracteres Crockford, con la misma forma que un ULID). Así los mensajes posteriores de ese mismo hilo del peer vuelven siempre a la misma conversación.

Antes se trataba un `thread_id` desconocido como «no hay hilo», de modo que el receptor **creaba una conversación por cada mensaje recibido**: la repregunta nunca quedaba junto a la pregunta original, la lista de conversaciones del dueño se llenaba de hilos de una sola línea, `loadA2AHistory` no encontraba historial, y el Agente respondía cada turno como si fuera la primera vez.

Derivarlo en vez de «guardar una tabla de correspondencias» tiene dos ventajas: no hace falta migración, y no hay carrera posible — dos mensajes que lleguen a la vez chocan en la clave primaria, en lugar de crear una conversación cada uno (por eso la creación va en una transacción con `onConflictDoNothing`). En la cadena que se concatena, solo el **último** segmento puede ser de longitud variable y estar bajo el control del peer; los anteriores son ids de 26 caracteres fijos, así que los dos puntos sin escapar no crean ambigüedad.

Al crear la conversación se escriben en `conversation_participants` **el dueño y el peer a la vez**. La fila de participante del dueño es lo que sostiene la lista de conversaciones y la compuerta de lectura conversación por conversación; sin ella, el dueño no vería el hilo que su propio Agente está respondiendo.

El `thread_id` es, por tanto, **el id de conversación de cada lado**, y no coincide entre ambos. De ahí salen dos reglas que no se pueden saltar:

- **La respuesta debe devolver el `thread_id` que envió quien preguntó, no el propio.** La condición 2 de arriba rechazaría (con razón) un hilo que no le pertenece, así que una respuesta que viaje con nuestro id de conversación queda archivada por el otro extremo en una conversación completamente nueva; quien preguntó sigue sondeando la que él creó, y `/api/v1/consult/{id}/reply` se queda para siempre en `pending`, mientras hay una respuesta perfectamente buena en las dos máquinas.
- **En `messages.thread_root` se escribe el id de la conversación local, jamás el valor que mandó el peer.** Esa columna es `char(26)` y está pensada para nuestros propios ULID: guardar un valor ajeno apuntaría a una conversación que quizá ni siquiera es nuestra, y además permitiría a cualquier peer tumbar el endpoint con un 500 mandando un `thread_id` de más de 26 caracteres. El `thread_id` entrante tiene además su propia validación de longitud.

### No poder responder también es una respuesta

Cuando el Agente destinatario no puede ejecutar el turno (no hay modelo configurado, el proveedor es desconocido, hay proveedor pero no clave, o la llamada al modelo lanzó un error), devuelve un `type: 'notification'` cuyo `context.error` lleva un código legible por máquina (`no_model_configured` / `unknown_provider` / `no_key_for_provider` / `agent_error`), y cuyo `content` es una frase explicativa en inglés. Se usa `notification` porque no provoca otra respuesta automática en el otro extremo (solo lo hace `question`).

No hacerlo no significa «falta un aviso»: el fallo se limita a escribir una línea de log en quien responde, no sale nada por el cable, y el `/api/v1/consult/{id}/reply` de quien preguntó sigue sondeando hasta agotar el plazo y devuelve `pending` — igual en cada reintento, **sin ninguna forma de distinguir entre "aún está pensando" y "no llegará nunca"**.

El otro extremo está en otra instancia y no comparte nuestro idioma, así que el criterio es el código de `context.error`; el `content` solo es el texto legible de reserva. Esto no contradice la regla de «el servidor no redacta texto para el usuario»: aquella regula lo que se envía **al cliente de esta misma instancia**.

**Ese mismo fallo también se escribe en la base de datos**, como un mensaje con `content_type: 'system_notice'` dentro de la conversación (`in_reply_to` apunta a la pregunta, `content_json` lleva el mismo código, y el cliente redacta la frase por i18n). Enviarlo sin guardarlo tiene tres consecuencias, y las tres se han dado: el dueño ve en su mensajería la pregunta de la otra parte seguida de nada, sin llegar a saber nunca que era él quien no tenía modelo configurado; la tarea del enlace REST de A2A se queda en `WORKING` en vez de `FAILED`, y el cliente sondea algo que no terminará jamás; y `GET /a2a/v1/stream/{id}` devuelve `pending` indefinidamente. Con esa nota, los tres pasan a la vez a un estado final decidible.

### Direccionamiento: dos DID apuntan al mismo Agente

`to` acepta tanto el **DID del Agente** (`did:web:<host>:agents:<user>:agent`, que es el que aparece en el directorio público `/.well-known/agents.json`) como el **DID del dueño** (`did:web:<host>:agents:<user>`). Este último es el único identificador que se resuelve a un documento DID, y es el que el cliente muestra al usuario para copiar: aceptar solo el primero hace que «añadir un contacto pegando su DID» produzca un contacto con el que se conecta, que verifica bien, y que responde 404.

Por lo mismo, al decidir si el peer remitente está conectado hay que aceptar tanto el `from` (DID del Agente) como el **DID del firmante obtenido al verificar la firma** (DID del dueño): en `peer_agents` la fila se crea por DID, y cuál de los dos quedó guardado depende de cómo se añadiera el contacto en su día; aceptar solo `from` convierte la respuesta del otro extremo en «una solicitud de conexión de un desconocido».

### Bandeja de pendientes (responder en ausencia)

Cuando llega la pregunta de un peer **ya conectado** y el dueño no está, decide el motor de políticas (`evaluatePolicy`, action=`ask`, L2):

- `allow` (por defecto, porque la conexión ya es el consentimiento) → el Agente responde directamente (`201` + bucle de respuesta automática).
- `ask_user` (el dueño ha puesto explícitamente `policies_json.default='ask_user'`, o una regla `{action:'ask',decision:'ask_user'}`) → **ya implementado**: la pregunta entrante se guarda y se difunde igualmente (el dueño la ve en su mensajería), pero **no se responde automáticamente**; se deja un permiso pendiente con `action='ask'` en la bandeja, y `POST /a2a/v1/messages` devuelve `202 { "status": "pending_approval", "message_id" }`. El dueño ve la pregunta en `GET /permissions/pending`; si en `POST /permissions/{id}/decide` resuelve `allow_*`, el Agente responde en su nombre (respuesta con `in_reply_to` + entrega saliente); si resuelve `deny`, no se responde. Del lado del peer, `GET /a2a/v1/stream/{message_id}` devuelve `status:'pending'` hasta la aprobación, y después la respuesta.
- `deny` (regla de denegación explícita) → `403 policy_denied`.

> **La capacidad de responder por A2A**: la respuesta A2A entrante y el chat web pasan por **la misma orquestación compartida** (`runAgentTurn`, en `orchestration/agent-orchestrator.ts`), pero **no tienen las mismas capacidades**. `runAgentTurn` recibe un `audience` obligatorio (`'owner' | 'peer'`, obligatorio y no con valor por defecto, porque el valor por defecto sería precisamente el permisivo), y de él dependen tanto el conjunto de herramientas como la superficie de datos alcanzable:
>
> - **Turno de dueño** (chat web): `web_search`, `search_knowledge_base` (todas las bases), `list_knowledge_bases`, `search_memory`, `list_contacts`, con recuperación automática de la memoria a largo plazo.
> - **Turno de peer** (respuesta A2A entrante): solo `web_search`, `search_knowledge_base` y `list_knowledge_bases`, y la búsqueda **se limita** a las bases marcadas como `shared_with_peers`; **no se recupera memoria a largo plazo**, y no se ofrecen `search_memory` ni `list_contacts` — la primera contiene hechos sedimentados de las conversaciones privadas del dueño, y la segunda es su grafo social; responder a la pregunta de un desconocido no necesita ninguna de las dos.
>
> La frontera la marca la **superficie de datos**, no el prompt: la pregunta del peer y las instrucciones del dueño llegan al modelo como el mismo tipo de texto, así que «el Agente se negará a revelarlo» no se sostiene; solo se sostiene que la búsqueda no pueda alcanzarlo físicamente. Por lo mismo, **no ofrecer una herramienta no es control de acceso**: el modelo puede invocar un nombre de herramienta que nunca se le dio, así que las ramas exclusivas del dueño vuelven a comprobar el `audience` dentro de `executeToolCall`.
>
> Los dos tipos de turno usan la clave **del dueño**, no la del peer que pregunta. Los fragmentos de base de conocimiento que se acierten se persisten como **citas** en `messages.citations_json`, y al terminar se sedimentan de forma asíncrona los hechos del turno en la memoria a largo plazo (las filas que vengan de un turno de peer se marcan como `a2a`, y al recuperarlas se indica su procedencia). Si el dueño no tiene claves de embedding, base de conocimiento o Tavily, se degrada con elegancia a una respuesta de LLM a secas (sin error y sin citas). La ruta de respuesta de `allow` y la de un `ask_user` aprobado comparten esta misma orquestación.

> El `scope_json` del permiso pendiente con `ask='ask'` tiene la forma `{ kind:'a2a_question', conversation_id, inbound_message_id, sender_did, peer_id, content }`, suficiente para reconstruir y reanudar la respuesta al aprobarla (el agente y el peer se recuperan en el momento por `user_id`/`peer_id`; es idempotente: si ya hay respuesta, se omite). La interfaz para configurar políticas permanentes, la opción de «editar y responder» y las notificaciones push siguen en el backlog.

## Descubrimiento federado

### Búsqueda por dominio

Dado el dominio `acme.com`, el cliente:

1. Recupera `https://acme.com/.well-known/did.json` para obtener el DID principal.
2. Recupera `https://acme.com/.well-known/agents.json` para listar todos los Agentes públicos de ese dominio.
3. Elige uno y lo añade como contacto.

### Resolución del DID de un usuario

Con el DID con subidentificador del Agente de un usuario, su documento DID se resuelve según la especificación de did:web:

- `did:web:acme.com:agents:laowang` → `GET https://acme.com/agents/laowang/did.json`
- El DID desnudo de la instancia, `did:web:acme.com` → `GET https://acme.com/.well-known/did.json`

La verificación de firma del A2A entrante sigue exactamente esa ruta: extrae el DID del firmante del `keyid` de `Signature-Input` → lo resuelve a la URL anterior → toma de `verificationMethod` la clave pública que coincide con `keyid` y verifica. Ese documento solo expone material de clave pública, y `verificationMethod[*].id` es el `key_id` almacenado (no se recompone a partir del Host de la petición), de modo que el id que se obtiene resolviendo desde otra instancia y el que se obtiene localmente son siempre el mismo.

### Registro público (v2 en adelante)

Conectar con el NANDA Index o un registro público similar, con soporte para:

- Buscar por capacidad («encuéntrame un Agente que sepa de Modbus»).
- Buscar por organización («el Agente de ABC Industries»).
- Buscar por ubicación («Agentes de servicio cerca de mí»).

### Grafo de confianza (v2 en adelante)

- Los Agentes de mis contactos aparecen primero.
- Los Agentes de la empresa de mis colegas aparecen primero.
- Los avales de terceros (verificados por NANDA) llevan una insignia de confianza.

## Antispam

- Limitación de tasa por dominio de peer y por minuto (contador en memoria del proceso; la pasarela es de instancia única).
- Los peers que no están en la lista blanca tienen baja prioridad por defecto.
- El usuario puede bloquear un dominio de peer.
- Puntuación de reputación (v2 en adelante): cuántas otras instancias lo han marcado como spam.

## Estrategia de traducción

- Cada Agente declara en sus AgentFacts un `primary_language` y un `style`.
- En una conversación entre idiomas, la traducción se hace **dentro del Agente de destino** (es quien mejor conoce su propia terminología y sus documentos).
- La parte citada **conserva siempre el original**: el usuario puede consultar la formulación autorizada antes de traducir.
- El comportamiento por defecto es `preserve-style` (se conserva el estilo y solo cambia el idioma); un escenario de consumo puede declarar `localize-style` (adaptarse a las convenciones locales).

## Estrategia de evolución del protocolo

- Todos los protocolos llevan un campo `@context` o `version`.
- Cliente y servidor mantienen compatibilidad hacia atrás (aceptan e ignoran los campos desconocidos).
- Los cambios que rompen compatibilidad van por un salto de versión mayor (por ejemplo `/a2a/v2/`).
- Compatible con la evolución de esquemas de NANDA y del A2A de Google (apostamos por el ecosistema abierto).

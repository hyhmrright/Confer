# Confer — Diseño del plugin MCP para Claude Code

Convertir Confer en un servidor MCP de Claude Code, para que Claude Code pueda consultar directamente a Agentes de proveedores o internos mientras escribe código, y depositar las respuestas en el proyecto. **Esta es la característica decisiva de Confer.**

## Principios de diseño

No se trata de «colgar una herramienta», sino de darle a Claude Code un **equipo de expertos de dominio**. Cada proveedor se corresponde con un «experto» de memoria duradera, y el conocimiento se deposita en el proyecto sin perderse entre sesiones.

Cinco pilares de diseño (el detalle estratégico está en `docs/01-product.md`):

1. Vendor specialist subagent — un experto de dominio persistente
2. Depósito de conocimiento a nivel de proyecto — `.claude/peers/`
3. Pre-flight design review — pasar por el experto antes de escribir código
4. Post-flight code review — que el experto revise el código ya escrito
5. Prioridad de autoridad + transparencia de identidad — dentro de su propio dominio, el juicio del proveedor pesa más que el del LLM general

## Instalación

> El `claude mcp add … @confer/mcp-server` con OAuth que aparece abajo es **la visión de destino**. La instalación real de la v0.1 está al final de esta sección, en «Implementación actual (v0.1)»: lo que existe hoy es el plugin `confer-a2a` con autenticación por variables de entorno.

```bash
# desde el punto de vista del usuario (visión)
claude mcp add confer npx -y @confer/mcp-server

# en el primer arranque, guía el OAuth que vincula la cuenta de Confer
claude mcp config confer
# elige la instancia: cloud.confer.ai o la URL de la tuya
# OAuth salta al navegador para autenticar
```

Fichero de configuración (lo edita el usuario):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # consultar automáticamente al detectar palabras clave
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "es"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### Implementación actual (v0.1)

El OAuth y el paquete npx de la visión aún no existen. Lo que sí está hecho es la **instalación en un clic desde el marketplace de plugins**, autenticando con variables de entorno (la clave privada de firma se queda siempre en la pasarela, nunca baja):

```bash
# 1. añade el marketplace e instala el plugin (este repositorio es el marketplace)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. exporta la cuenta en el shell (el plugin la lee del entorno; las credenciales no se escriben en el repositorio)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# opcional: export CONFER_GATEWAY_URL=http://localhost:3000  (valor por defecto)
```

El plugin lleva un bundle autocontenido (`plugins/confer-a2a/dist/server.mjs`, que corre con `node` a secas, sin monorepo ni `bun`), generado desde `packages/mcp-a2a` con `bun run --filter @confer/mcp-a2a build:plugin`. Ofrece 15 herramientas (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply`, entre otras); los detalles están en `plugins/confer-a2a/README.md` y `packages/mcp-a2a/README.md`.

Quien desarrolle dentro del repositorio puede prescindir del plugin y usar directamente el `.mcp.json` de la raíz (que apunta al `server.ts` del código fuente) o `claude mcp add`.

## Herramientas MCP expuestas

### `ask_peer`

Preguntar algo a un Agente peer.

```typescript
{
  name: "ask_peer",
  description: "Ask a peer Agent a question. Use this when you need vendor-specific or domain-specific knowledge that may not be in your training data.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string", description: "Peer slug (e.g. 'abc-industries') or DID" },
      question: { type: "string" },
      context: { type: "string", description: "Optional context: what we're trying to do" },
      thread_id: { type: "string", description: "Continue an existing conversation" }
    },
    required: ["peer", "question"]
  }
}
```

Devuelve:

```json
{
  "answer": "Con 0x03, Read Holding Registers…",
  "citations": [{"source": "Manual de comunicaciones del X100 v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

Listar los Agentes peer disponibles ahora mismo.

```typescript
{
  name: "list_peers",
  description: "List peer Agents registered for this project, with their capabilities.",
  inputSchema: {
    type: "object",
    properties: {
      authority: { type: "string", description: "Filter by authority keyword (e.g. 'Modbus')" }
    }
  }
}
```

### `discover_peer`

Descubrir un Agente peer nuevo (búsqueda por dominio).

```typescript
{
  name: "discover_peer",
  description: "Discover a peer Agent by domain or DID. Use this when the user mentions a vendor that's not yet registered.",
  inputSchema: {
    type: "object",
    properties: {
      domain: { type: "string", description: "e.g. 'abc-industries.com'" }
    },
    required: ["domain"]
  }
}
```

### `read_project_memory`

Leer el conocimiento depositado en este proyecto.

```typescript
{
  name: "read_project_memory",
  description: "Read accumulated facts and decisions for a peer in this project. Use this at the start of relevant tasks to load context.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      section: { type: "string", enum: ["facts", "decisions", "conversations", "meta"] }
    },
    required: ["peer"]
  }
}
```

### `write_project_memory`

Escribir conocimiento de proyecto (normalmente se llama sola tras ask_peer, pero también a mano).

```typescript
{
  name: "write_project_memory",
  description: "Write a verified fact or decision to project memory. Auto-called after ask_peer for important answers.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      section: { type: "string", enum: ["facts", "decisions"] },
      key: { type: "string", description: "Short identifier" },
      content: { type: "string", description: "Markdown content" },
      citations: { type: "array", items: { type: "object" } }
    },
    required: ["peer", "section", "key", "content"]
  }
}
```

### `request_design_review`

Pre-flight: pasar el plan de diseño por el experto.

```typescript
{
  name: "request_design_review",
  description: "Submit a design plan to a peer Agent for review before implementing. Strongly recommended for non-trivial vendor-specific work.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      plan: { type: "string", description: "Markdown-formatted plan" },
      scope: { type: "string", description: "What part of the system" }
    },
    required: ["peer", "plan"]
  }
}
```

### `request_code_review`

Post-flight: que el experto revise el código ya escrito.

```typescript
{
  name: "request_code_review",
  description: "Submit a code diff to a peer Agent for review after writing. Useful for catching vendor-specific gotchas.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      files: { type: "array", items: { type: "object", properties: { path: {}, content: {} } } },
      focus: { type: "string", description: "What to focus on" }
    },
    required: ["peer", "files"]
  }
}
```

## Recursos MCP expuestos

Claude Code puede referenciarlos con la sintaxis `@resource:…`.

### `confer://peers/{peer_slug}/facts`

Devuelve el fichero de facts en formato markdown.

### `confer://peers/{peer_slug}/conversations/{thread_id}`

Devuelve el registro completo de una conversación.

### `confer://threads/{thread_id}`

Devuelve, como contexto, una conversación del IM del programa principal (el usuario puede copiar la URL del hilo desde el IM y dársela a Claude Code).

## Prompts MCP expuestos

Plantillas de prompt preparadas, que el usuario puede disparar rápidamente.

### `consult-vendor`

```
"Help me design how to integrate {topic}. Before writing code,
consult the relevant vendor Agent via ask_peer, and load any
existing project memory."
```

### `verify-with-source`

```
"Review the current implementation in {file}. For each
vendor-specific decision, verify with the relevant peer Agent
and add citation comments where they're missing."
```

## Comportamiento autónomo

Cuando Claude Code llama al servidor MCP de Confer, el servidor le da pistas para que se comporte con más criterio:

### Señales que disparan ask_peer automáticamente

```toml
[auto_consult.triggers]
keywords_match_authority = true        # aparecen en el código o la conversación palabras de peer.authority
explicit_uncertainty     = true        # cuando Claude Code dice «I'm not sure»
import_vendor_lib        = true        # se ha importado el SDK de algún proveedor
```

Cómo se implementa: el servidor MCP añade la pista en la descripción de la herramienta; por ejemplo, al final de la de `ask_peer`:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

Claude Code ve esa pista y decide por sí mismo llamar.

### Escritura automática de la memoria de proyecto

Cada vez que `ask_peer` tiene éxito, el servidor MCP intenta extraer de forma estructurada los «hechos» de la respuesta y escribirlos en `facts.md`:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## Identidad de extremo a extremo

La petición A2A lleva la etiqueta `via: claude-code`:

```json
{
  "from": "did:web:cloud.confer.ai:users:laowang",
  "to":   "did:web:acme.com:agents:support",
  "context": {
    "via":        "claude-code",
    "project":    "modbus-integration",
    "intent":     "code-generation"
  },
  "message": { /* ... */ }
}
```

El Agente del otro lado puede ajustar el estilo de su respuesta según `context.via`:

- `via: claude-code` → respuesta estructurada (bloques de código, JSON, nombres de campo claros)
- `via: web` → respuesta en lenguaje natural, con más explicación y contexto
- `via: mobile` → conciso, con lo importante destacado, cómodo de leer en pantalla pequeña

Esta pista no es obligatoria y el otro Agente puede ignorarla. Pero conviene que todos la respeten.

## Seguridad y confianza

### Capa de permisos

Que Claude Code llame a `ask_peer` por MCP es L1 por defecto (consulta de solo lectura). En cambio:

- `request_code_review` (compartir código con el peer) → L2, se pregunta al usuario la primera vez
- `share_files` (compartir un directorio de ficheros) → L2
- `commit_on_behalf` (decidir en nombre del usuario) → L3, se pregunta cada vez

La solicitud de permiso se reenvía por el servidor MCP al programa principal, que muestra una tarjeta de permiso en la interfaz de IM; el usuario decide y el resultado vuelve a Claude Code, que sigue trabajando.

### Capa de confianza

- con `peer.{slug}.trust = "high"`, la respuesta de ese peer dentro de su ámbito de autoridad pesa más que el conocimiento general de Claude Code
- con `trust = "medium"`, la cita sirve de referencia pero Claude Code la marca como tal
- con `trust = "low"`, o si el peer es nuevo y no está verificado, siempre se le pide al usuario que confirme el resultado citado

### Ritmo y coste

Límite de tasa local en el servidor MCP:

- como mucho 50 `ask_peer` a un mismo peer dentro de una sesión de Claude Code
- al superar el acumulado, aparece un aviso de «¿seguimos?»
- se muestra el coste estimado de cada llamada (según el modelo que use el Agente del otro lado)

## Comandos de CLI

Comandos auxiliares, para usar desde el shell:

```bash
# lista los peers registrados
confer peer list

# añade un peer
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # consulta el well-known automáticamente

# consulta la memoria del proyecto
confer memory show abc-industries
confer memory show abc-industries --section facts

# pregunta directa desde la línea de comandos
confer ask abc-industries "¿Cuál es el rango de tensión del X100 en modo RTU?"

# sincroniza la memoria del proyecto con el servidor de Confer
confer sync push
confer sync pull
```

## Notas de implementación del servidor MCP

Pila técnica:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- caché local en SQLite (para no golpear el servidor cada vez)
- el token se guarda en Keychain / Credential Manager

Ficheros principales:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # punto de entrada del servidor MCP
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # cliente de la API de Confer
│   ├── auth.ts               # flujo OAuth
│   ├── cache.ts              # caché local en SQLite
│   └── config.ts             # lee .claude/confer.toml
└── package.json
```

Ejemplo del punto de entrada:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { tools } from "./tools";
import { resources } from "./resources";
import { prompts } from "./prompts";

const server = new Server(
  { name: "confer", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

tools.forEach((t) => server.setRequestHandler(t.schema, t.handler));
resources.forEach((r) => server.registerResource(r));
prompts.forEach((p) => server.registerPrompt(p));

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Criterios de aceptación (v1)

- [ ] `claude mcp add confer` instala en una línea
- [ ] el primer arranque guía la configuración de OAuth de principio a fin
- [ ] `ask_peer` tarda menos de 10 s de extremo a extremo (incluido el tiempo de pensar del LLM)
- [ ] `read_project_memory` en menos de 100 ms (con acierto de la caché local)
- [ ] la revisión pre-flight logra que Claude Code corrija el plan
- [ ] la memoria del proyecto viaja con el repositorio tras un commit de git
- [ ] al menos un Agente de proveedor público disponible (para la demo: mock-vendor.confer.dev)

## Estado de la implementación (v0.1)

Todo lo anterior es la visión completa. La primera versión sobre el terreno, `packages/mcp-a2a`, ya cierra el ciclo central de «consultar a un agente peer»:

**Arquitectura (dos capas)**

- La pasarela gana la capacidad de consulta A2A saliente iniciada por el usuario (`/api/v1/consult/*`, véase `docs/05-api.md`). Hasta entonces la plataforma solo tenía un camino para enviar mensajes A2A —«entrante → respuesta automática»— y ninguna ruta saliente por iniciativa del usuario.
- `packages/mcp-a2a`: un servidor MCP por stdio que inicia sesión en la pasarela con la identidad de **un usuario de Confer configurado** para obtener un token, y expone la capacidad de consulta como herramientas. La firma sigue ocurriendo en la pasarela; la clave privada no sale de ella.

**Herramientas implementadas (15)**

| Ámbito | Herramientas |
|----|------|
| Descubrimiento | `list_agents` / `get_agent_capabilities` / `find_agents` |
| Consulta | `ask_agent` (espera síncrona) / `follow_up` / `get_conversation` |
| Avanzado | `ask_multiple` (en paralelo, máximo 5) / `check_reply` (recogida asíncrona) |
| Operación | `whoami` |
| Persona concreta | `ask_person_agent` (preguntar al agente de una persona en particular; el asistente rellena los datos) |
| Memoria de proyecto | `read_project_memory` (lee facts/decisions; que falten es vacío, no error) / `write_project_memory` (escribe facts o decisions sin que uno borre al otro, incrementando `version`) |
| Descubrimiento + revisión | `discover_peer` (descubre un peer por domain/did/username, lo guarda y devuelve su `peer_id`; **no crea la relación de contacto** — hay que aceptarlo antes como contacto en el programa principal, o cualquier escritura de memoria o consulta posterior recibe un `403`, que es la puerta del consentimiento) / `request_design_review` (pedir al peer que revise un plan) / `request_code_review` (pedir al peer que revise unos ficheros) |

El parámetro `project` de las herramientas de memoria puede omitirse; al omitirlo se cae al `projectId` configurado en el MCP (la variable de entorno `CONFER_PROJECT_ID`, cuyo valor por defecto es el basename del directorio de trabajo).

**Conexión**

```jsonc
{
  "mcpServers": {
    "confer-a2a": {
      "command": "bun",
      "args": ["run", "packages/mcp-a2a/src/server.ts"],
      "env": {
        "CONFER_GATEWAY_URL": "http://localhost:3000",
        "CONFER_USERNAME": "${CONFER_USERNAME}",
        "CONFER_PASSWORD": "${CONFER_PASSWORD}",
        // opcional: el id que da alcance a la memoria de proyecto; por defecto, el nombre del directorio de trabajo
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**Distancia con la visión (pendiente)**: la vinculación por OAuth, la memoria duradera del vendor specialist y el depósito en `.claude/peers/`, las revisiones pre/post-flight y la prioridad de autoridad siguen en el backlog. Hoy la identidad es la de un único usuario configurado, las respuestas llegan por long polling, y los permisos pendientes se presentan de momento como `pending`.

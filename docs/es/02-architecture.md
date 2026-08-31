# Confer — arquitectura del sistema

> **Este documento describe la arquitectura objetivo, no lo que hay implementado hoy.** La implementación actual es un gateway de **un solo proceso y una sola instancia**: la tabla de conexiones WebSocket, los nonces de protección contra reenvío de A2A y los contadores de limitación de tasa viven todos en la memoria del proceso del gateway (`ws/handler.ts`, `lib/nonce-cache.ts`, `middleware/rate-limit.ts`).
>
> **Por eso el gateway no puede correr con una segunda réplica.** Añadir réplicas rompe en silencio la protección contra reenvío de A2A: cuando la petición reenviada cae en otra réplica, su tabla de nonces está vacía y la deja pasar. Además, las notificaciones por WS se pierden para los usuarios conectados a otra réplica, y el umbral de limitación se multiplica por el número de réplicas.
>
> NATS y Redis, mencionados más abajo, son la solución prevista para escalar horizontalmente; **hoy no están desplegados ni conectados a nada** (se retiraron de `docker-compose*.yml` y de `env.ts` el 2026-08-07; hasta entonces eran contenedores girando en vacío y una variable de entorno que nadie leía). Si de verdad hace falta escalar horizontalmente, primero hay que mover ese estado en memoria a un almacén compartido, empezando por los nonces, que son lo crítico para la seguridad.

## Arquitectura de alto nivel

```
┌────────────────────────────────────────────────────────────┐
│  Clients (Tauri 2.0)                                       │
│  iOS · Android · Windows · macOS · Linux                   │
└──────────────────────────┬─────────────────────────────────┘
                           │ WSS / HTTPS / SSE
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Edge API Gateway  (Bun + Hono)                            │
│  Auth · Rate limit · Routing · WS fan-out                  │
└─────┬─────────────┬─────────────────┬────────────────┬─────┘
      │             │                 │                │
      ▼             ▼                 ▼                ▼
 ┌────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────┐
 │ Agent  │  │Conversation │  │ Identity & │  │ MCP / Tools  │
 │Runtime │  │     Hub     │  │A2A Gateway │  │  Connector   │
 └───┬────┘  └──────┬──────┘  └─────┬──────┘  └──────┬───────┘
     │              │               │                │
     ▼              ▼               ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  Data layer: PostgreSQL · Redis · NATS · Vector (Qdrant)·S3 │
└──────────────────────────────────────────────────────────────┘
       │                              │
       ▼                              ▼
 LLM providers              Other instances' Agents
 (Claude / GPT /            (federation via A2A
  DeepSeek / Qwen)           over HTTPS)
```

## Principios de diseño

- **Borde sin estado, núcleo con estado** (objetivo, no implementado): que el gateway no tenga estado y escale horizontalmente es la forma a la que aspiramos; **hoy el gateway tiene estado en memoria y solo admite una instancia**, como explica la nota inicial.
- **Preparado para la federación desde el primer día**: identidad DID:web + AgentFacts, y una sola instancia ya funciona según el protocolo de federación, de modo que federarse más adelante no cuesta ninguna migración.
- **Trae tu propia clave de LLM**: la plataforma no asume el coste del LLM; cada usuario usa su propia clave de API.
- **El protocolo primero**: la interacción central usa protocolos abiertos (A2A, MCP, DID:web, NANDA AgentFacts), sin atarse a un protocolo propietario nuestro.
- **Bun + TypeScript de punta a punta**: backend en Bun + Hono, cliente en Tauri + React, con tipos compartidos.

## Fronteras entre servicios

### 1. Edge API Gateway

Véase `docs/05-api.md`.

- **Responsabilidad**: terminación TLS, doble autenticación (usuario y A2A), limitación de tasa en cuatro dimensiones, enrutado HTTP/WS/SSE, difusión a varios dispositivos.
- **Tecnología**: Bun + Hono.
- **Dependencias clave**: JWKS (validación del token de usuario), caché de documentos DID, NATS (difusión).
- **Lo que no hace**: lógica de negocio, persistir datos de negocio, llamar al LLM.

### 2. Agent Runtime

Cada usuario tiene una instancia de Agente residente.

- **Responsabilidad**:
  - Mantener el estado del Agente del usuario (elección de modelo, herramientas, política, memoria).
  - El bucle de llamadas al LLM (con abstracción de múltiples proveedores).
  - Cliente MCP, conectado a los servidores de herramientas que el usuario haya instalado.
  - Llamadas A2A salientes (ir a hablar con el Agente de otra persona).
  - Motor de políticas (decidir qué se le puede contar a la otra parte).
- **Ciclo de vida**: se despierta a demanda. Cuando llega un mensaje o una petición A2A, carga su estado de PostgreSQL, ejecuta un turno y lo vuelve a escribir.
- **Dependencias clave**: proveedores de LLM, servidores MCP, servicio de identidad.

### 3. Conversation Hub

- **Responsabilidad**: almacenamiento de mensajes, suscripción y entrega.
- **Tipos de conversación admitidos**:
  - Usuario ↔ su propio Agente.
  - Usuario ↔ Agente ajeno (pasando por su propio Agente).
  - Usuario ↔ usuario (mensajería normal).
  - Grupos (usuarios y Agentes mezclados).
- **Dependencias clave**: NATS Streams (persistencia + difusión), PostgreSQL (histórico de mensajes), Redis (presencia, contadores de no leídos).

### 4. Identity & A2A Gateway

- **Responsabilidad**:
  - Gestionar los documentos DID:web de los usuarios.
  - Exponer y cachear AgentFacts.
  - Atender las peticiones A2A entrantes (verificar la firma HTTP y el token de capacidad).
  - Reenviar las peticiones A2A salientes.
  - Limitación de tasa y antispam para los peers federados.
- **Dependencias clave**: PostgreSQL (caché de DID y de peers), Redis (contadores de limitación).

El diseño detallado del protocolo está en `docs/03-protocol.md`.

### 5. MCP / Tools Connector

- **Responsabilidad**:
  - Gestión de las conexiones a los servidores de herramientas MCP que el usuario haya instalado.
  - El Agent Runtime llama a las herramientas por aquí.
  - Envoltura normalizada de los resultados de las llamadas a herramientas.
- **Dependencias clave**: `@modelcontextprotocol/sdk`.

## Capa de datos

| Componente | Para qué | Estado |
|---|---|---|
| PostgreSQL | Usuarios, Agentes, conversaciones, mensajes, permisos, relaciones con peers (almacén principal) | ✅ en uso |
| Qdrant | RAG de la memoria a largo plazo del Agente, índice de las bases de conocimiento del usuario | ✅ en uso |
| Compatible con S3 (MinIO) | Almacenamiento de los archivos de las bases de conocimiento | ✅ en uso |
| Redis | Sesión, presencia, contadores de limitación, caché de datos calientes | ⬜ no desplegado; solo hará falta al escalar horizontalmente |
| NATS Streams | Difusión de mensajes (user.{uid}.events) + cola de tareas del Agent Runtime | ⬜ no desplegado; solo hará falta al escalar horizontalmente |

## Arquitectura del cliente

- **Base**: Tauri 2.0 (núcleo en Rust + renderizado en WebView).
- **Frontend**: React 19 + TypeScript + Tailwind CSS.
- **Estado**: Zustand o Jotai (ligeros).
- **Enrutado**: TanStack Router.
- **Red**: fetch nativo + WebSocket nativo + EventSource (SSE).
- **Almacenamiento local**: SQLite y el almacén clave-valor que ofrece Tauri (caché de conversaciones, borradores de mensajes sin conexión).

### Cobertura multiplataforma

| Plataforma | A través de |
|---|---|
| iOS | Soporte iOS de Tauri 2.0 |
| Android | Soporte Android de Tauri 2.0 |
| Windows | Tauri 2.0 |
| macOS | Tauri 2.0 |
| Linux | Tauri 2.0 |

Un único código base, sin alternativas nativas.

### Plugin de Claude Code

Véase `docs/06-claude-code-plugin.md`.

- Un proceso servidor MCP aparte, implementado con Node.js o Bun.
- El usuario lo instala con `claude mcp add confer <command>`.
- Se vincula a la cuenta de Confer del usuario mediante OAuth o un token.

## Arquitectura de despliegue

### Instancia única (personas / equipos pequeños)

El `docker-compose.prod.yml` real (agent-runtime e identity son librerías dentro del gateway, no servicios propios):

```
  - gateway   (servicio Bun, una sola réplica — véase la nota inicial)
  - client    (frontend servido por nginx)
  - migrate   (tarea de una sola ejecución)
  - postgres
  - qdrant
  - minio
```

Despliegue: `docker compose -f docker-compose.prod.yml up -d` y ya funciona.

### Instancia de empresa

- El mismo Docker Compose levantado como despliegue independiente.
- Con dominio propio (`acme.com`).
- Publicando `https://acme.com/.well-known/did.json` y `https://acme.com/.well-known/agent.json`.
- Los usuarios internos entran por SSO.

### Nube (la nube propia de Confer)

> Condición previa: hoy el gateway es de una sola réplica (estado en el proceso). Antes de poner varias hay que mover la tabla de conexiones WS, los nonces de A2A y los contadores de limitación a un almacén compartido, o la protección contra reenvío falla en silencio.

- Kubernetes multiinquilino.
- Cada usuario o empresa con su propio namespace o esquema.
- Capa de abstracción de proveedores de LLM compartida (pero cada uno sigue usando su propia clave).
- Despliegue en varias regiones del mundo, con entrada por la región más cercana.

## Federación (entre instancias)

Cualquier instancia de Confer, autoalojada o en la nube, puede comunicarse con otras por el protocolo A2A.

```
[acme.com]              [vendor-x.com]            [confer.cloud]
 Agent A    <─── A2A ───> Agent B    <─── A2A ───> Agent C
```

Identidad y descubrimiento:

- Cada instancia publica su documento DID en `/.well-known/did.json`.
- Cada Agente publica sus AgentFacts en `/.well-known/agent.json`.
- Búsqueda entre instancias: difusión a las instancias conocidas + registro público.

## Observabilidad

- **Trazas**: OpenTelemetry; el `trace_id` se inyecta en el gateway y recorre todos los servicios.
- **Registros**: JSON estructurado, recogido con Vector / Loki.
- **Métricas**: Prometheus. Las principales:
  - `gateway_active_ws_connections{user_id}`
  - `agent_runtime_llm_tokens_total{provider,role}`
  - `a2a_inbound_requests_total{peer_domain,status}`
  - `mcp_tool_calls_total{tool,result}`

## Fronteras de seguridad

- Usuario ↔ gateway: JWT verificado con JWKS.
- Peer A2A ↔ gateway: HTTP Message Signatures (RFC 9421) + clave pública DID:web.
- RPC interno entre servicios: mTLS o secreto compartido (dentro de la red de Docker).
- Llamadas a proveedores de LLM: clave de API cifrada en reposo (AES-256, con la clave en Vault / KMS).
- Archivos de los usuarios: cifrado en el lado del servidor de S3.

## Decisiones técnicas clave

| Decisión | Elección | Alternativas | Motivo |
|---|---|---|---|
| Lenguaje del backend | Bun + TypeScript | Go | Los SDK de MCP y A2A son TS primero; los tipos se comparten en toda la pila |
| Framework web | Hono | Elysia, Fastify | Ligero, rápido, con un ecosistema estable |
| Cliente | Tauri 2.0 | Flutter, Electron | Un código base para cinco plataformas, la seguridad de Rust, binarios pequeños |
| Almacén principal | PostgreSQL 18 | MySQL | Buen soporte de JSON, muy extensible, pgvector como opción |
| Bus de mensajes | NATS | Kafka, Redis Pub/Sub | Ligero, con persistencia y suscripción precisa |
| Base vectorial | Qdrant | Pinecone, pgvector | Maduro para autoalojar, escrito en Rust, rendimiento estable |
| Identidad | DID:web | DID:key, solo OAuth | Compatible con la infraestructura web existente, recomendado por NANDA |
| Protocolo | A2A + MCP + AgentFacts | Un protocolo propio | Apostamos por el ecosistema de protocolos abiertos |

# Confer — Hoja de ruta del MVP y pendientes

Cortado por hitos; cada hito es una versión entregable y demostrable.

## v0.1 — Core proof of concept (4-6 semanas)

**Objetivo**: que en una sola máquina funcione de punta a punta la cadena «usuario ↔ su propio Agente ↔ Agente ajeno».

**Alcance (obligatorio)**

- [x] backend: gateway + agent runtime + conversation + identity (cuatro servicios, en un proceso o por separado, da igual)
- [x] esquema de PostgreSQL (véase 04-data-model.md), gestionado con una herramienta de migraciones
- [x] registro y acceso de usuarios (basta con contraseña; nada de OAuth ni passkey)
- [x] generación y publicación del documento DID:web (`/.well-known/did.json`)
- [x] generación y publicación del documento AgentFacts
- [ ] protocolo A2A entrante y saliente (verificación de firma HTTP + verificación del capability token)
- [x] agent runtime: el bucle de llamadas al LLM (de momento solo dos proveedores, Claude y DeepSeek)
- [x] motor de políticas simple: peers en lista blanca, con todo permitido o todo denegado
- [x] cliente: una única aplicación Tauri, primero los tres escritorios (Linux / macOS / Windows; el móvil, más adelante)
- [x] que el cliente pueda: iniciar sesión, añadir contactos (por DID), conversar uno a uno y ver las citas
- [x] empuje de mensajes en tiempo real por WebSocket (una instancia basta; sin fan-out por NATS)
- [x] salida del LLM en flujo por SSE
- [x] entorno de desarrollo local en un solo paso con Docker Compose

**Out of scope**:

- grupos, fan-out a varios dispositivos, móvil, interfaz multilingüe, CDN, OAuth externo, políticas complejas
- el plugin de Claude Code no entra aquí todavía

**Acceptance**:

Dos personas levantan cada una su instancia local de Confer, se añaden mutuamente, conversan y ven las citas.

---

## v0.2 — MVP del plugin de Claude Code (3-4 semanas)

**Objetivo**: poder consultar a un Agente peer desde Claude Code, y que la respuesta se deposite en el proyecto.

**Scope**:

- [x] implementar el servidor MCP, con cuatro herramientas: `ask_peer`, `list_peers`, `read_project_memory` y `write_project_memory`
- [ ] vincular la cuenta de Confer a la instancia de Claude Code al estilo OAuth
- [ ] análisis del fichero de configuración `.claude/confer.toml`
- [ ] lectura y escritura del directorio `.claude/peers/{slug}/` (facts.md, decisions.md, conversations/, meta.json)
- [ ] extracción automática de hechos: tras ask_peer, sacar de la respuesta los hechos estructurados y escribirlos en facts.md
- [ ] la herramienta de línea de comandos `confer` (add peer, list peers, ask, sync)
- [ ] un Agente peer de demostración (mock-vendor.confer.dev) con el que probar

**Acceptance**:

Alguien instala `claude mcp add confer`, lo configura, y desde Claude Code puede preguntarle al mock vendor; la respuesta llega con citas, se escribe en `.claude/peers/mock-vendor/facts.md`, se comitea a git y en la siguiente sesión se carga sola.

---

## v0.3 — Grupos e instancias de empresa (4-5 semanas)

**Objetivo**: admitir conversaciones de grupo (personas y Agentes mezclados) y poder desplegar una «instancia de empresa» en una máquina.

**Scope**:

- [ ] modelo de datos e interfaz para los grupos
- [ ] gestión de miembros del grupo (añadir y quitar personas y Agentes)
- [ ] varios Agentes mencionados responden a la vez (presentación plegada, con mecanismo de «adoptar»)
- [ ] instancia de empresa: dominio propio y acceso por SSO (basta con OIDC)
- [x] descubrimiento de contactos: buscar por dominio (al escribir acme.com se encuentran los Agentes que ese dominio publica)
- [ ] fan-out a varios dispositivos (entra NATS)
- [ ] móvil (iOS y Android)

**Acceptance**:

Un equipo de cinco personas y dos Agentes discuten un proyecto en un mismo grupo, con buena fluidez. Una empresa puede montar su propia instancia de Confer, publicar Agentes hacia fuera, y que otras instancias los encuentren.

---

## v0.4 — Multilingüe y respuesta en diferido (3 semanas)

**Objetivo**: hacer útil el producto en escenarios internacionales y de comunicación semiasíncrona.

**Scope**:

- [x] i18n de la interfaz (empezando por chino e inglés, dejando sitio a japonés, alemán y francés)
- [ ] conversación entre Agentes en idiomas distintos (la traducción ocurre dentro del Agente de destino, y la cita conserva el original)
- [ ] añadir el campo `primary_language` a AgentFacts
- [ ] respuesta en diferido: interfaz para fijar la standing policy, bandeja de pendientes y notificaciones push
- [x] añadir al servidor MCP la herramienta de pre-flight design review
- [x] añadir al servidor MCP la herramienta de post-flight code review

**Acceptance**:

Alguien en China le pregunta en chino al Agente de un fabricante alemán (con documentación en alemán) y recibe la respuesta en chino con la cita en el alemán original. Con una standing policy fijada, el Agente atiende correctamente las peticiones que cumplen la regla mientras su dueño está ausente, y deja en suspenso las dudosas.

---

## v1.0 — Listo para producción (4-6 semanas)

**Objetivo**: poder usarse en producción y ofrecer soporte comercial.

**Scope**:

- [ ] observabilidad completa (trazas OTel, métricas Prometheus, logs Loki)
- [ ] copia de seguridad y restauración (respaldo físico de PG + incremental a S3)
- [x] auditoría de seguridad (las operaciones críticas dejan audit log)
- [ ] límites de tasa afinados (las cuatro dimensiones)
- [ ] panel de consumo de LLM (coste mensual por Agente)
- [ ] experiencia completa de BYO LLM key (almacenamiento cifrado, rotación, cuota)
- [x] sitio de documentación (manual de uso, manual de autoalojamiento, referencia de la API)
- [ ] puesta en marcha de la instancia pública Confer Cloud (`cloud.confer.ai`)

**Acceptance**:

Al menos 100 usuarios registrados, 10 Agentes peer desplegados de forma independiente, y una instancia funcionando de forma estable más de 30 días.

---

## v1.5+ — Crecimiento y ecosistema (continuo)

**Scope**:

- [ ] directorio público de Agentes (conectado al NANDA Index)
- [ ] grafo de confianza y sistema de reputación
- [ ] versión de consumo para particulares (interfaz más ligera)
- [ ] antispam basado en reputación
- [ ] webhooks (integración con sistemas de terceros)
- [ ] varios Agentes por usuario (una persona con varios Agentes especializados)
- [ ] extensión de navegador (invocar al Agente desde una página web)

---

## Granularidad de las tareas (para Claude Code)

Cada hito se descompone en entre 50 y 200 tareas pequeñas. Cada tarea:

1. tiene entradas y salidas claras
2. tiene criterios de aceptación comprobables
3. no supera un día-persona de trabajo

Por ejemplo, algunas tareas de la v0.1:

### Esqueleto del backend

- [x] crear el monorepo (workspaces de pnpm o de Bun)
- [x] `packages/shared`: definiciones de tipos compartidas (con zod o valibot)
- [x] `packages/gateway`: esqueleto de la aplicación Bun + Hono
- [x] `packages/agent-runtime`: esqueleto de la máquina de estados del Agente
- [x] ~~`packages/conversation`: servicio de almacenamiento y empuje de mensajes~~ — absorbido por el gateway (`ws/handler.ts` + `routes/conversations.ts`); el paquete aparte no tenía ni un consumidor, y se eliminó el 2026-08-07
- [x] `packages/identity`: DID + AgentFacts + verificación A2A
- [x] herramienta de migraciones de PostgreSQL (drizzle-kit o prisma)
- [x] crear los ficheros de migración de todas las tablas

### Capa de base de datos

- [x] CRUD de User (registro, acceso, consulta del perfil)
- [x] CRUD de Agent (crear el Agente propio, cambiar su configuración)
- [x] CRUD de PeerAgent (añadir, consultar y borrar contactos)
- [x] CRUD de Conversation y gestión de Participant
- [x] CRUD de Message y paginación
- [x] escritura y consulta de la tabla Permission

### Identidad y protocolo

- [x] generación del documento DID (un par de claves ed25519 por usuario)
- [x] `/.well-known/did.json` endpoint
- [x] generación de AgentFacts y su endpoint
- [x] firmador de firmas HTTP (salida)
- [x] verificador de firmas HTTP (entrada)
- [ ] emisión y verificación de capability tokens
- [x] descargador de documentos DID + caché

### Abstracción del LLM

- [x] interfaz de proveedor de LLM (chat, stream, tools)
- [x] implementación del proveedor Claude
- [x] implementación del proveedor DeepSeek
- [x] almacenamiento cifrado de las claves de API (Vault / env)
- [x] aplicar la configuración de modelo por Agente

### Agent runtime

- [x] máquina de estados del Agente: bucle load → process → save
- [x] bucle de llamadas al LLM con tool calling
- [x] motor de políticas simple (lista blanca + allow/deny)
- [x] llamada A2A saliente (el Agente escribe a otro)
- [x] atención A2A entrante (llega el mensaje del Agente de otra persona)

### Gateway y API

- [x] middleware de emisión y verificación de JWT
- [x] todos los endpoints `/api/v1/auth/*`
- [x] todos los endpoints `/api/v1/conversations/*`
- [x] handler de WebSocket (suscribirse, enviar mensajes)
- [x] handler de SSE (salida del LLM en flujo)
- [x] endpoints A2A de entrada + middleware de verificación de firma
- [x] middleware de límite de tasa (primero la versión simple: ventana fija)

### Cliente

- [x] inicializar el proyecto Tauri 2.0
- [x] páginas de acceso y registro
- [x] pantalla principal: lista de contactos a la izquierda, conversación a la derecha
- [x] diálogo de añadir contacto (por DID o por dominio)
- [x] lista de mensajes de la conversación (renderizado en flujo)
- [x] renderizado de las cápsulas de cita
- [x] renderizado de la tarjeta de solicitud de permiso
- [x] gestión de la conexión WebSocket
- [ ] caché local en SQLite de los últimos 100 mensajes

### Contenido de demostración

- [ ] desplegar el Agente de mock-vendor (para la demo)
- [ ] manual simulado del X100 (unas páginas en PDF como datos para el RAG)
- [ ] vídeo o documento de demostración: el recorrido completo, de añadir un contacto a obtener la respuesta

---

## Riesgos y decisiones tempranas necesarias

| Riesgo | Mitigación |
|---|---|
| El SDK de MCP sigue evolucionando y su API puede romper | Fijarse a la versión estable, vigilar el changelog, hacer una capa de adaptación |
| El protocolo A2A (Google) y el estándar NANDA también siguen evolucionando | Arrancar con el subconjunto mínimo, dejando sitio a una capa de adaptación del protocolo |
| Tauri 2.0 en iOS y Android es relativamente nuevo y puede dar sorpresas | En el MVP, solo los tres escritorios; el móvil en la v0.3 |
| El coste del LLM se descontrola | Cuota por defecto + BYO key explícita + panel de consumo pronto |
| Los SDK de los proveedores de LLM chinos (DeepSeek/Qwen) no son estables | Usar la interfaz compatible con OpenAI (todos estos proveedores la admiten) como punto de entrada único |

## Indicaciones de implementación para Claude Code

1. **Primero las pruebas unitarias, después la integración**: cada servicio tiene que poder pasar sus pruebas sin depender de que los demás estén levantados
2. **Las migraciones de base de datos van con la herramienta de migraciones**, nada de SQL a mano
3. **Los tipos se comparten a través del paquete `@confer/shared`**, y sirven a cliente y servidor
4. **Cada PR lleva su cambio de documentación** (si ha tocado el protocolo o la API)
5. **Para implementar el protocolo A2A, mejor una biblioteca existente** (por ejemplo el paquete npm `http-message-signatures`) que reinventar la rueda
6. **Para DID:web, mejor `did-resolver` + `did-jwt`**, que son herramientas del W3C
7. **Para el servidor MCP, mejor el SDK oficial** (`@modelcontextprotocol/sdk`)
8. **Escribe el asunto del commit como una frase que diga qué hace el cambio**, no como un prefijo convencional. Ojo: `.github/scripts/gen-release-notes.sh` solo reconoce prefijos del estilo `feat:` / `fix:`, así que las notas de versión hay que escribirlas a mano — de asuntos en prosa no las genera

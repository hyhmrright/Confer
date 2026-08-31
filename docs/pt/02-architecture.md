# Confer — arquitetura do sistema

> **Este documento descreve a arquitetura pretendida, não o que está implementado.** A implementação atual é um gateway de **processo único e instância única**: a tabela de conexões WebSocket, os nonces de proteção contra repetição do A2A e os contadores de limitação de taxa vivem todos na memória do processo (`ws/handler.ts`, `lib/nonce-cache.ts`, `middleware/rate-limit.ts`).
>
> **Por isso o gateway não pode rodar com uma segunda réplica.** Acrescentar réplicas quebra silenciosamente a proteção contra repetição do A2A: a requisição repetida cai em outra réplica, cuja tabela de nonces está vazia, e passa direto. Além disso, os avisos por WS não chegam aos usuários conectados em outra réplica, e o limite de taxa se multiplica pelo número de réplicas.
>
> NATS e Redis, citados adiante, são a solução prevista para escalar horizontalmente; **hoje não estão implantados nem ligados a nada** (removidos de `docker-compose*.yml` e de `env.ts` em 2026-08-07; até então eram contêineres girando em vazio e uma variável de ambiente que ninguém lia). Para escalar horizontalmente de verdade, primeiro é preciso mover esses três estados em memória para um armazenamento compartilhado — os nonces em primeiro lugar, que são o ponto crítico de segurança.

## Arquitetura em alto nível

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

## Princípios de projeto

- **Borda sem estado, núcleo com estado** (pretendido, não implementado): um gateway sem estado e escalável horizontalmente é a forma almejada; **hoje o gateway tem estado em memória e só admite uma instância**, como diz a nota de abertura.
- **Pronto para federação desde o primeiro dia**: identidade DID:web + AgentFacts, e mesmo uma instância única já fala o protocolo de federação, de modo que federar depois não custa migração nenhuma.
- **Traga a sua chave de LLM**: a plataforma não arca com o custo do LLM; cada um usa a própria chave de API.
- **Protocolo primeiro**: a interação central usa protocolos abertos (A2A, MCP, DID:web, NANDA AgentFacts), sem amarrar ninguém a um protocolo proprietário nosso.
- **Bun + TypeScript de ponta a ponta**: backend em Bun + Hono, cliente em Tauri + React, tipos compartilhados.

## Fronteiras entre serviços

### 1. Edge API Gateway

Ver `docs/05-api.md`.

- **Responsabilidade**: terminação TLS, dupla autenticação (usuário e A2A), limitação de taxa em quatro dimensões, roteamento HTTP/WS/SSE, distribuição para vários dispositivos.
- **Tecnologia**: Bun + Hono.
- **Dependências principais**: JWKS (validação do token do usuário), cache de documentos DID, NATS (distribuição).
- **O que não faz**: lógica de negócio, persistir dados de negócio, chamar o LLM.

### 2. Agent Runtime

Cada usuário tem uma instância de Agente residente.

- **Responsabilidade**:
  - Manter o estado do Agente do usuário (escolha do modelo, ferramentas, política, memória).
  - O laço de chamadas ao LLM (com abstração de vários provedores).
  - Cliente MCP, conectado aos servidores de ferramentas que o usuário instalou.
  - Chamadas A2A de saída (ir conversar com o Agente de outra pessoa).
  - Motor de políticas (decidir o que pode ser dito ao outro lado).
- **Ciclo de vida**: acordado sob demanda. Quando chega uma mensagem ou uma requisição A2A, carrega o estado do PostgreSQL, executa um turno e grava de volta.
- **Dependências principais**: provedores de LLM, servidores MCP, serviço de identidade.

### 3. Conversation Hub

- **Responsabilidade**: armazenamento, assinatura e entrega de mensagens.
- **Tipos de conversa suportados**:
  - Usuário ↔ o próprio Agente.
  - Usuário ↔ Agente alheio (passando pelo próprio Agente).
  - Usuário ↔ usuário (mensageria comum).
  - Grupos (usuários e Agentes misturados).
- **Dependências principais**: NATS Streams (persistência + distribuição), PostgreSQL (histórico), Redis (presença, contadores de não lidas).

### 4. Identity & A2A Gateway

- **Responsabilidade**:
  - Gerenciar os documentos DID:web dos usuários.
  - Expor e cachear os AgentFacts.
  - Tratar as requisições A2A de entrada (verificar a assinatura HTTP e o token de capacidade).
  - Encaminhar as requisições A2A de saída.
  - Limitação de taxa e antispam para os peers federados.
- **Dependências principais**: PostgreSQL (cache de DID e de peers), Redis (contadores de limitação).

O projeto detalhado do protocolo está em `docs/03-protocol.md`.

### 5. MCP / Tools Connector

- **Responsabilidade**:
  - Gerenciar as conexões com os servidores de ferramentas MCP instalados pelo usuário.
  - É por aqui que o Agent Runtime chama as ferramentas.
  - Empacotamento padronizado dos resultados das chamadas de ferramentas.
- **Dependências principais**: `@modelcontextprotocol/sdk`.

## Camada de dados

| Componente | Para quê | Situação |
|---|---|---|
| PostgreSQL | Usuários, Agentes, conversas, mensagens, permissões, relações com peers (armazenamento principal) | ✅ em uso |
| Qdrant | RAG da memória de longo prazo do Agente, índice das bases de conhecimento do usuário | ✅ em uso |
| Compatível com S3 (MinIO) | Armazenamento dos arquivos das bases de conhecimento | ✅ em uso |
| Redis | Sessão, presença, contadores de limitação, cache de dados quentes | ⬜ não implantado; só será preciso ao escalar horizontalmente |
| NATS Streams | Distribuição de mensagens (user.{uid}.events) + fila de tarefas do Agent Runtime | ⬜ não implantado; só será preciso ao escalar horizontalmente |

## Arquitetura do cliente

- **Base**: Tauri 2.0 (núcleo em Rust + renderização em WebView).
- **Frontend**: React 19 + TypeScript + Tailwind CSS.
- **Estado**: Zustand ou Jotai (leves).
- **Roteamento**: TanStack Router.
- **Rede**: fetch nativo + WebSocket nativo + EventSource (SSE).
- **Armazenamento local**: SQLite e o armazenamento chave-valor fornecidos pelo Tauri (cache de conversas, rascunhos offline).

### Cobertura multiplataforma

| Plataforma | Por meio de |
|---|---|
| iOS | Suporte a iOS do Tauri 2.0 |
| Android | Suporte a Android do Tauri 2.0 |
| Windows | Tauri 2.0 |
| macOS | Tauri 2.0 |
| Linux | Tauri 2.0 |

Um único código-base, sem alternativas nativas.

### Plugin do Claude Code

Ver `docs/06-claude-code-plugin.md`.

- Um processo servidor MCP à parte, escrito em Node.js ou Bun.
- O usuário instala com `claude mcp add confer <command>`.
- Vincula-se à conta Confer do usuário por OAuth ou token.

## Arquitetura de implantação

### Instância única (pessoas / times pequenos)

O `docker-compose.prod.yml` real (agent-runtime e identity são bibliotecas dentro do gateway, não serviços próprios):

```
  - gateway   (serviço Bun, réplica única — ver a nota de abertura)
  - client    (frontend servido pelo nginx)
  - migrate   (tarefa de execução única)
  - postgres
  - qdrant
  - minio
```

Implantação: `docker compose -f docker-compose.prod.yml up -d` e já funciona.

### Instância corporativa

- O mesmo Docker Compose subido como implantação independente.
- Com domínio próprio (`acme.com`).
- Publicando `https://acme.com/.well-known/did.json` e `https://acme.com/.well-known/agent.json`.
- Os usuários internos entram por SSO.

### Nuvem (a nuvem da própria Confer)

> Pré-requisito: hoje o gateway é de réplica única (estado no processo). Antes de colocar várias, é preciso mover a tabela de conexões WS, os nonces do A2A e os contadores de limitação para um armazenamento compartilhado, ou a proteção contra repetição falha em silêncio.

- Kubernetes multi-inquilino.
- Cada usuário ou empresa com o próprio namespace ou esquema.
- Camada de abstração de provedores de LLM compartilhada (mas cada um continua com a própria chave).
- Implantação em várias regiões do mundo, com entrada pela região mais próxima.

## Federação (entre instâncias)

Qualquer instância do Confer, auto-hospedada ou na nuvem, pode se comunicar com outras pelo protocolo A2A.

```
[acme.com]              [vendor-x.com]            [confer.cloud]
 Agent A    <─── A2A ───> Agent B    <─── A2A ───> Agent C
```

Identidade e descoberta:

- Cada instância publica o seu documento DID em `/.well-known/did.json`.
- Cada Agente publica os seus AgentFacts em `/.well-known/agent.json`.
- Busca entre instâncias: distribuição para as instâncias conhecidas + registro público.

## Observabilidade

- **Rastreamento**: OpenTelemetry; o `trace_id` é injetado no gateway e atravessa todos os serviços.
- **Logs**: JSON estruturado, coletado por Vector / Loki.
- **Métricas**: Prometheus. As principais:
  - `gateway_active_ws_connections{user_id}`
  - `agent_runtime_llm_tokens_total{provider,role}`
  - `a2a_inbound_requests_total{peer_domain,status}`
  - `mcp_tool_calls_total{tool,result}`

## Fronteiras de segurança

- Usuário ↔ gateway: JWT verificado com JWKS.
- Peer A2A ↔ gateway: HTTP Message Signatures (RFC 9421) + chave pública DID:web.
- RPC interno entre serviços: mTLS ou segredo compartilhado (dentro da rede do Docker).
- Chamadas a provedores de LLM: chave de API cifrada em repouso (AES-256, com a chave no Vault / KMS).
- Arquivos dos usuários: criptografia do lado do servidor no S3.

## Decisões técnicas centrais

| Decisão | Escolha | Alternativas | Motivo |
|---|---|---|---|
| Linguagem do backend | Bun + TypeScript | Go | Os SDKs de MCP e A2A são TS primeiro; tipos compartilhados em toda a pilha |
| Framework web | Hono | Elysia, Fastify | Leve, rápido, ecossistema estável |
| Cliente | Tauri 2.0 | Flutter, Electron | Um código-base para cinco plataformas, a segurança do Rust, binários pequenos |
| Armazenamento principal | PostgreSQL 18 | MySQL | Bom suporte a JSON, muito extensível, pgvector como opção |
| Barramento de mensagens | NATS | Kafka, Redis Pub/Sub | Leve, com persistência e assinatura precisa |
| Banco vetorial | Qdrant | Pinecone, pgvector | Maduro para auto-hospedagem, escrito em Rust, desempenho estável |
| Identidade | DID:web | DID:key, só OAuth | Compatível com a infraestrutura web existente, recomendado pela NANDA |
| Protocolo | A2A + MCP + AgentFacts | Um protocolo próprio | Apostamos no ecossistema de protocolos abertos |

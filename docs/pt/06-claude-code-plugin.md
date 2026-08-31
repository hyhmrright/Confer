# Confer — Desenho do plugin MCP para o Claude Code

Transformar o Confer num servidor MCP do Claude Code, para que o Claude Code possa consultar diretamente Agentes de fornecedores ou internos enquanto escreve código, e depositar as respostas no projeto. **Esta é a funcionalidade decisiva do Confer.**

## Princípios de desenho

Não se trata de «pendurar uma ferramenta», mas de dar ao Claude Code uma **equipe de especialistas de domínio**. Cada fornecedor corresponde a um «especialista» com memória duradoura, e o conhecimento se deposita no projeto sem se perder entre sessões.

Cinco pilares de desenho (o detalhe estratégico está em `docs/01-product.md`):

1. Vendor specialist subagent — um especialista de domínio persistente
2. Depósito de conhecimento no nível do projeto — `.claude/peers/`
3. Pre-flight design review — passar pelo especialista antes de escrever código
4. Post-flight code review — deixar o especialista revisar o código já escrito
5. Prioridade de autoridade + transparência de identidade — dentro do próprio domínio, o julgamento do fornecedor pesa mais que o do LLM genérico

## Instalação

> O `claude mcp add … @confer/mcp-server` com OAuth abaixo é **a visão de destino**. A instalação real da v0.1 está no fim desta seção, em «Implementação atual (v0.1)»: o que existe hoje é o plugin `confer-a2a` com autenticação por variáveis de ambiente.

```bash
# do ponto de vista do usuário (visão)
claude mcp add confer npx -y @confer/mcp-server

# no primeiro arranque, guia o OAuth que vincula a conta do Confer
claude mcp config confer
# escolha a instância: cloud.confer.ai ou a URL da sua
# o OAuth salta para o navegador para autenticar
```

Arquivo de configuração (editado pelo usuário):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # consultar automaticamente ao detectar palavras-chave
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "pt"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### Implementação atual (v0.1)

O OAuth e o pacote npx da visão ainda não existem. O que está feito é a **instalação em um clique pelo marketplace de plugins**, autenticando por variáveis de ambiente (a chave privada de assinatura fica sempre no gateway e nunca desce):

```bash
# 1. adicione o marketplace e instale o plugin (este repositório é o marketplace)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. exporte a conta no shell (o plugin a lê do ambiente; as credenciais não vão para o repositório)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# opcional: export CONFER_GATEWAY_URL=http://localhost:3000  (valor padrão)
```

O plugin traz um bundle autocontido (`plugins/confer-a2a/dist/server.mjs`, que roda com `node` puro, sem monorepo nem `bun`), gerado a partir de `packages/mcp-a2a` por `bun run --filter @confer/mcp-a2a build:plugin`. Oferece 15 ferramentas (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply`, entre outras); os detalhes estão em `plugins/confer-a2a/README.md` e `packages/mcp-a2a/README.md`.

Quem desenvolve dentro do repositório pode dispensar o plugin e usar direto o `.mcp.json` da raiz (que aponta para o `server.ts` do código-fonte) ou `claude mcp add`.

## Ferramentas MCP expostas

### `ask_peer`

Fazer uma pergunta a um Agente peer.

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

Retorna:

```json
{
  "answer": "Com 0x03, Read Holding Registers…",
  "citations": [{"source": "Manual de comunicação do X100 v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

Listar os Agentes peer disponíveis no momento.

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

Descobrir um novo Agente peer (busca por domínio).

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

Ler o conhecimento depositado neste projeto.

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

Escrever conhecimento de projeto (normalmente chamada sozinha após ask_peer, mas também manualmente).

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

Pre-flight: passar o plano de desenho pelo especialista.

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

Post-flight: deixar o especialista revisar o código já escrito.

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

## Recursos MCP expostos

O Claude Code pode referenciá-los com a sintaxe `@resource:…`.

### `confer://peers/{peer_slug}/facts`

Retorna o arquivo de facts em formato markdown.

### `confer://peers/{peer_slug}/conversations/{thread_id}`

Retorna o registro completo de uma conversa.

### `confer://threads/{thread_id}`

Retorna, como contexto, uma conversa do IM do programa principal (o usuário pode copiar a URL do fio no IM e dá-la ao Claude Code).

## Prompts MCP expostos

Modelos de prompt prontos, que o usuário pode disparar rapidamente.

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

## Comportamento autônomo

Quando o Claude Code chama o servidor MCP do Confer, o servidor lhe dá dicas para que se comporte com mais critério:

### Sinais que disparam ask_peer automaticamente

```toml
[auto_consult.triggers]
keywords_match_authority = true        # aparecem no código ou na conversa palavras de peer.authority
explicit_uncertainty     = true        # quando o Claude Code diz «I'm not sure»
import_vendor_lib        = true        # o SDK de algum fornecedor foi importado
```

Como se implementa: o servidor MCP acrescenta a dica na descrição da ferramenta; por exemplo, no fim da de `ask_peer`:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

O Claude Code vê essa dica e decide sozinho chamar.

### Escrita automática da memória de projeto

A cada `ask_peer` bem-sucedido, o servidor MCP tenta extrair de forma estruturada os «fatos» da resposta e escrevê-los em `facts.md`:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## Identidade ponta a ponta

A requisição A2A leva a etiqueta `via: claude-code`:

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

O Agente do outro lado pode ajustar o estilo da resposta conforme `context.via`:

- `via: claude-code` → resposta estruturada (blocos de código, JSON, nomes de campo claros)
- `via: web` → resposta em linguagem natural, com mais explicação e contexto
- `via: mobile` → conciso, com o essencial em destaque, cômodo de ler em tela pequena

Essa dica não é obrigatória e o Agente do outro lado pode ignorá-la. Mas convém que todos a respeitem.

## Segurança e confiança

### Camada de permissões

O Claude Code chamar `ask_peer` por MCP é L1 por padrão (consulta somente leitura). Já:

- `request_code_review` (compartilhar código com o peer) → L2, pergunta-se ao usuário na primeira vez
- `share_files` (compartilhar um diretório de arquivos) → L2
- `commit_on_behalf` (decidir em nome do usuário) → L3, pergunta-se toda vez

O pedido de permissão é repassado pelo servidor MCP ao programa principal, que mostra um cartão de permissão na interface de IM; o usuário decide e o resultado volta ao Claude Code, que segue trabalhando.

### Camada de confiança

- com `peer.{slug}.trust = "high"`, a resposta desse peer dentro do seu escopo de autoridade pesa mais que o conhecimento geral do Claude Code
- com `trust = "medium"`, a citação serve de referência mas o Claude Code a marca como tal
- com `trust = "low"`, ou para um peer recém-adicionado e não verificado, sempre se pede ao usuário que confirme o resultado citado

### Ritmo e custo

Limite de taxa local no servidor MCP:

- no máximo 50 `ask_peer` para o mesmo peer dentro de uma sessão do Claude Code
- ao ultrapassar o acumulado, aparece um aviso de «continuamos?»
- mostra-se o custo estimado de cada chamada (conforme o modelo que o Agente do outro lado usa)

## Comandos de CLI

Comandos auxiliares, para usar no shell:

```bash
# lista os peers registrados
confer peer list

# adiciona um peer
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # consulta o well-known automaticamente

# consulta a memória do projeto
confer memory show abc-industries
confer memory show abc-industries --section facts

# pergunta direta pela linha de comando
confer ask abc-industries "Qual é a faixa de tensão do X100 em modo RTU?"

# sincroniza a memória do projeto com o servidor do Confer
confer sync push
confer sync pull
```

## Pontos de implementação do servidor MCP

Pilha técnica:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- cache local em SQLite (para não bater no servidor toda vez)
- o token fica no Keychain / Credential Manager

Arquivos principais:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # ponto de entrada do servidor MCP
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # cliente da API do Confer
│   ├── auth.ts               # fluxo OAuth
│   ├── cache.ts              # cache local em SQLite
│   └── config.ts             # lê .claude/confer.toml
└── package.json
```

Exemplo do ponto de entrada:

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

## Critérios de aceitação (v1)

- [ ] `claude mcp add confer` instala em uma linha
- [ ] o primeiro arranque guia a configuração de OAuth do início ao fim
- [ ] `ask_peer` leva menos de 10 s ponta a ponta (incluído o tempo de pensar do LLM)
- [ ] `read_project_memory` em menos de 100 ms (com acerto do cache local)
- [ ] a revisão pre-flight faz o Claude Code corrigir o plano
- [ ] a memória do projeto acompanha o repositório após um commit do git
- [ ] pelo menos um Agente de fornecedor público disponível (para a demo: mock-vendor.confer.dev)

## Estado da implementação (v0.1)

Tudo acima é a visão completa. A primeira versão em campo, `packages/mcp-a2a`, já fecha o ciclo central de «consultar um agente peer»:

**Arquitetura (duas camadas)**

- O gateway ganha a consulta A2A de saída iniciada pelo usuário (`/api/v1/consult/*`, veja `docs/05-api.md`). Até então a plataforma tinha um único caminho de envio A2A — «entrada → resposta automática» — e nenhuma rota de saída por iniciativa do usuário.
- `packages/mcp-a2a`: um servidor MCP por stdio que entra no gateway com a identidade de **um usuário do Confer configurado** para obter um token, e expõe a capacidade de consulta como ferramentas. A assinatura continua no gateway; a chave privada não sai dele.

**Ferramentas implementadas (15)**

| Domínio | Ferramentas |
|----|------|
| Descoberta | `list_agents` / `get_agent_capabilities` / `find_agents` |
| Consulta | `ask_agent` (espera síncrona) / `follow_up` / `get_conversation` |
| Avançado | `ask_multiple` (em paralelo, no máximo 5) / `check_reply` (coleta assíncrona) |
| Operação | `whoami` |
| Pessoa específica | `ask_person_agent` (perguntar ao agente de uma pessoa em particular; o assistente preenche) |
| Memória de projeto | `read_project_memory` (lê facts/decisions; a ausência dá vazio, não erro) / `write_project_memory` (escreve facts ou decisions sem que um apague o outro, incrementando `version`) |
| Descoberta + revisão | `discover_peer` (descobre um peer por domain/did/username, grava-o e devolve o `peer_id`; **não estabelece a relação de contato** — é preciso aceitá-lo antes como contato no programa principal, senão qualquer escrita de memória ou consulta posterior recebe `403`, que é o portão do consentimento) / `request_design_review` (pedir ao peer que revise um plano) / `request_code_review` (pedir ao peer que revise arquivos) |

O parâmetro `project` das ferramentas de memória pode ser omitido; omitido, cai no `projectId` configurado no MCP (a variável de ambiente `CONFER_PROJECT_ID`, cujo padrão é o basename do diretório de trabalho).

**Conexão**

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
        // opcional: o id que delimita a memória de projeto; por padrão, o nome do diretório de trabalho
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**Distância para a visão (a seguir)**: a vinculação por OAuth, a memória duradoura do vendor specialist e o depósito em `.claude/peers/`, as revisões pre/post-flight e a prioridade de autoridade seguem no backlog. Hoje a identidade é a de um único usuário configurado, as respostas chegam por long polling, e as permissões pendentes são apresentadas por ora como `pending`.

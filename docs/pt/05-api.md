# Confer — Especificação da API

Define todas as API entre o cliente e o servidor, e entre o servidor e os peers A2A.

## Convenções gerais

- Base URL: `https://{instance}/api`
- Codificação: JSON, UTF-8
- Formato de data e hora: ISO 8601, UTC (`2024-11-15T14:30:00Z`)
- Identificadores: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- Formato de erro:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## Autenticação

- Cliente do usuário: `Authorization: Bearer <jwt_access_token>`
- TTL do access token: 15 minutos; TTL do refresh token: 90 dias
- Os dois tokens se distinguem pela claim `typ` (`access` / `refresh`) e **não são intercambiáveis**: o cabeçalho `Authorization` só aceita `access`, e `POST /auth/refresh` só aceita `refresh`. Antes eles diferiam apenas no `exp`, de modo que o refresh token era um passe de 90 dias em qualquer endpoint autenticado e os 15 minutos do access token não valiam nada
- O refresh rotaciona a cada uso e é conferido contra `sessions.refresh_token_hash`; se não bater, trata-se de reuso e a sessão inteira é invalidada. `sessions.expires_at` é o limite **absoluto** da sessão: a rotação não o estende
- Os tokens ficam no armazenamento local do cliente, não em um cookie HTTP-only (o cliente é um aplicativo de desktop Tauri, onde não existe equivalente aos cookies de mesma origem)

## API do cliente (usada pelo cliente do usuário)

### Autenticação

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` requisição:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

Resposta:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### Configuração do usuário e do Agente

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # se cada fornecedor está configurado (devolve apenas booleanos, nunca a chave)
PUT    /api/v1/agents/me/llm-keys      # guarda cifradas as chaves de API dos LLM
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # consulta ao vivo, no fornecedor, quais modelos ele oferece
```

Os valores de `provider` vêm do catálogo de fornecedores de `@confer/shared` (`packages/shared/src/llm/catalog.ts`), mais o serviço de ferramentas `tavily`. O catálogo é lido ao mesmo tempo pelo gateway, pelo agent-runtime e pelo cliente: a base URL, o caminho da lista de modelos e o modelo padrão só existem naquele único lugar, então acrescentar um fornecedor mexe apenas no catálogo.

`/models` repassa a lista de modelos do próprio fornecedor e nunca devolve uma lista mantida localmente:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// uma lista vazia sempre traz o motivo; os quatro são distintos e cada um pede um remédio diferente
{ "models": [], "error": "no_key" }        // esse fornecedor ainda não tem chave configurada
{ "models": [], "error": "unauthorized" }  // o fornecedor recusou a chave (401/403)
{ "models": [], "error": "unreachable" }   // não foi possível alcançar o fornecedor, ou ele devolveu outro erro
{ "models": [], "error": "unsupported" }   // esse fornecedor não oferece endpoint de listagem de modelos
```

### Contatos / Agentes peer

```
GET    /api/v1/contacts                     # lista os contatos. Paginação: ?limit=&offset=
POST   /api/v1/contacts                     # adiciona um contato
GET    /api/v1/contacts/{contact_id}        # detalhe de um contato (com o peer)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # altera parcialmente alias / tags / pinned / muted (campos ausentes não são apagados)

POST   /api/v1/contacts/lookup              # busca por DID / domínio / nome de usuário
```

`POST /api/v1/contacts/lookup` requisição:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` devolve `{ contacts, total }`. `limit` é 50 por padrão, com teto de 100, e `offset` é 0; a ordenação é por `id` (ULID) em ordem decrescente, ou seja, o mais recente primeiro — uma ordenação única e determinística é justamente o que impede a janela de offset de pular ou repetir linhas. `total` é a contagem completa, não a desta página, e é por ela que o cliente sabe que chegou ao fim. Um `limit` ou `offset` ilegível assume o valor padrão em vez de gerar erro.

Resposta: a lista de Agentes candidatos encontrados. A busca **grava em `peer_agents`** os peers que descobre e inclui em cada candidato o `id` local (`peer_id`) — e é exatamente esse `id` que `POST /api/v1/contacts` usa para adicionar o contato. `POST /contacts` é idempotente: adicionar o mesmo peer de novo devolve o contato já existente (`200`) em vez de erro.

> Adicionar um contato é **o consentimento com que quem recebe autoriza o outro a consumir o seu Agente**: só um peer adicionado como contato pode fazer o meu Agente responder (e gastar o meu orçamento de LLM). Mensagens A2A de um peer não conectado ficam pendentes como um pedido de conexão a aprovar; veja «O portão do consentimento de conexão» em `03-protocol.md`.

```
POST   /api/v1/contacts/{contact_id}/policies   # define as políticas permanentes (substituição integral, semântica de PUT)
```

O corpo de `POST /contacts/{id}/policies` tem a forma de execução `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` e é gravado inteiro em `peer_contacts.policy_overrides_json`. **Semântica de mesclagem**: ao decidir sobre uma requisição A2A de entrada, essa sobreposição por contato se soma à política do Agente — se `contact.default` estiver presente, substitui o padrão do Agente, e `contact.rules` vem antes das regras do Agente, portanto é avaliado primeiro (uma regra precisa por contato vence uma regra geral do Agente). Uma sobreposição vazia `{}` é a identidade: a decisão coincide byte a byte com a que se tomaria sem sobreposição.

### Conversas

```
GET    /api/v1/conversations                       # lista as minhas conversas (para a tela inicial)
POST   /api/v1/conversations                       # cria uma conversa
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # paginação: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # envia uma mensagem
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # recebe por SSE a resposta do LLM em fluxo

POST   /api/v1/conversations/{id}/participants     # adiciona um participante
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # marca como lida
```

`POST /api/v1/conversations/{id}/messages` requisição:

```json
{
  "content_type": "text",
  "content": "Que código de função o registrador 0x40 do X100 usa?",
  "in_reply_to": null,
  "via": "web"
}
```

Resposta:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### Gestão de permissões

```
GET    /api/v1/permissions/pending               # pedidos L2/L3 pendentes
POST   /api/v1/permissions/{id}/decide           # aprovar ou recusar
GET    /api/v1/permissions/history               # histórico
```

`POST /api/v1/permissions/{id}/decide` requisição:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // alcance da decisão
}
```

Entre os pedidos pendentes, os de `action='connect'` são **pedidos de conexão** (gerados pela entrada A2A no primeiro contato de um peer desconhecido). Aprovar (`allow_*`) grava esse peer em `peer_contacts` e estabelece a conexão; recusar não estabelece.

Os de `action='ask'` são **perguntas pendentes de um peer já conectado**: a entrada A2A os gera quando a política do Agente decide `ask_user` para aquela pergunta (veja «Caixa de pendências (resposta em diferido)» em `03-protocol.md`). Aprovar (`allow_*`) faz o Agente responder à pergunta suspensa; recusar a deixa sem resposta.

`GET /pending` acompanha cada pedido de uma `description` (o pedido de conexão traz quem o iniciou e a primeira mensagem; a pergunta traz quem pergunta e o texto) para o dono poder decidir.

### Memória de projeto (ligada à integração com o Claude Code)

```
GET    /api/v1/projects/{project_id}/peers              # os peers com memória neste projeto (name/did vindos do join)  ✅ implementado
POST   /api/v1/projects/{project_id}/peers              # registra explicitamente um peer no projeto   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implementado
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implementado
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implementado
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implementado
```

Notas de semântica (v0.1):

- Todas as consultas são limitadas a `user.sub` (isolamento entre usuários).
- Antes de um PUT verifica-se que o peer é contato daquele usuário (`peer_contacts`); se não for, devolve-se `403 not_a_contact`.
- O PUT faz upsert: a primeira escrita deixa `version=1`, e cada seguinte incrementa `version` e atualiza `updated_at`. `facts` e `decisions` são independentes — escrever uma seção não apaga a outra.
- `GET facts/decisions` devolve `200`, string vazia e `version:0` quando aquele par (projeto, peer) ainda não tem memória (não um 404: «este peer ainda não deixou nada» é um estado normal na leitura).
- `project_id` é validado por `^[a-zA-Z0-9._\-/]+$` (1 a 255 caracteres); se não passar, devolve-se `400 invalid_project_id`.
- `GET peers` devolve um array vazio num projeto sem nada. A relação (projeto, peer) nasce implicitamente do PUT de facts/decisions (nesta fase não há registro explícito por `POST peers`).

### Base de conhecimento (RAG)

```
GET    /api/v1/knowledge-bases                                  # lista as minhas bases de conhecimento
POST   /api/v1/knowledge-bases                                  # cria uma
PATCH  /api/v1/knowledge-bases/{kb_id}                          # muda nome ou descrição, e se fica aberta a Agentes externos
DELETE /api/v1/knowledge-bases/{kb_id}                          # apaga junto com todos os seus documentos e vetores

GET    /api/v1/knowledge-bases/{kb_id}/documents                # paginação: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # envio multipart, campo chamado file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # reindexa
```

O corpo de `POST /knowledge-bases` é `{ name, description? }` (`name` de 1 a 255 caracteres) e a resposta é `201` com `{ knowledge_base }`.

O corpo de `PATCH /knowledge-bases/{kb_id}` é `{ name?, description?, shared_with_peers? }` e a resposta é `{ knowledge_base }`. **`shared_with_peers` só se muda aqui; na criação não é aceito**: toda base nasce «só para mim», e abri-la ao exterior é um segundo gesto deliberado.

O que `shared_with_peers` decide é **se uma pergunta A2A de entrada pode buscar nessa base**, e o padrão é `false`. Não afeta o dono quando ele conversa na web: ele sempre busca em tudo. Essa fronteira tem de cair sobre o alcance da busca, e não sobre o prompt: a pergunta do outro e as instruções do dono chegam ao modelo como o mesmo tipo de texto, de modo que «deixar o Agente julgar o que pode contar» não constitui fronteira nenhuma. Pela mesma razão, uma pergunta A2A de entrada **não recupera nenhuma memória de longo prazo**: a memória de longo prazo é destilada das conversas do próprio dono, e nem uma de suas entradas foi marcada como apta a sair desta instância.

`GET /knowledge-bases` devolve `{ knowledge_bases }` e **não é paginado**: as bases de um usuário são criadas à mão e o seu número é limitado.

`GET /{kb_id}/documents` devolve `{ documents, total }`. `limit` é 50 por padrão, com teto de 100, e `offset` é 0; ordena-se por `id` (ULID) em ordem decrescente, ou seja, o mais recente primeiro — uma ordenação única e determinística é o que impede a janela de offset de pular ou repetir linhas. `total` é a contagem completa, não a desta página. Um `limit` ou `offset` ilegível assume o valor padrão em vez de gerar erro. Esta é a única lista desta seção que cresce sem limite, porque a base de conhecimento é justamente o destino dos envios.

O envio vai por `multipart/form-data`, o campo do arquivo chama-se sempre `file` e cada arquivo tem teto de **10 MB** (acima disso, `400 bad_request`). O `Content-Type` é o do formulário quando vem e, na falta, é deduzido da extensão. A resposta é `201` com `{ document }`, e nesse momento `status` já vale `processing`: **o fatiamento, a vetorização e a escrita no Qdrant acontecem de forma assíncrona depois da resposta**, o endpoint de envio não os espera. O cliente então consulta a lista de documentos até `status` mudar.

Valores de `status`:

| Valor | Significado |
|---|---|
| `processing` | Já gravado, sendo fatiado ou vetorizado. É o estado inicial após o envio e após um retry |
| `ready` | Pode ser pesquisado. `chunk_count` é o número de fragmentos do documento |
| `failed` | A indexação falhou (na análise, por falta de chave de embedding, ou na escrita no banco vetorial) |

`POST /{doc_id}/retry` busca o arquivo original no armazenamento de objetos e reindexa; antes apaga os vetores que aquele documento já tinha, então não surgem fragmentos duplicados. Devolve `400` se o arquivo original já não existe (`storage_key` vazio) ou se o documento ainda está em `processing`. A resposta é `{ document }`, com `status` de volta a `processing` e `chunk_count` zerado.

Apagar uma base de conhecimento apaga em cascata todas as suas linhas de documento e os vetores no Qdrant; apagar um único documento limpa ainda os seus vetores e o arquivo original no armazenamento de objetos. Uma falha na limpeza de vetores ou objetos não impede a exclusão no banco: melhor deixar um objeto órfão do que uma linha apontando para dados já apagados.

Todos os endpoints são limitados a `user.sub`: acessar a base ou o documento de outra pessoa devolve `404` (e não `403`, para não revelar que existe).

> O proxy reverso precisa deixar passar corpos de 10 MB. `infra/nginx.conf` define `client_max_body_size 10m` em `/api/`; com o padrão do nginx, 1 MB, arquivos de 1 a 10 MB nem chegam ao gateway e o navegador recebe a página 413 do próprio nginx.

### Anexos

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # download (302 para uma URL assinada)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### Endpoint

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

A autenticação do handshake é idêntica à do REST, não um «a assinatura confere, pode passar»: `typ` tem de ser `access`, `sid` tem de apontar para uma sessão que ainda exista, e a conta não pode estar `disabled`. As três são indispensáveis: sem elas, basta a uma conta banida ter um token não expirado para reconectar e continuar recebendo mensagens, enquanto o próprio banimento (apagar todas as sessões) não revoga nada por esse caminho. Banir também **fecha os sockets já abertos** daquele usuário: o nginx dá a `/ws` um `proxy_read_timeout` de um dia, e barrar o próximo handshake não barra a conexão já estabelecida.

### Formato das mensagens

Todas as mensagens WS são JSON e trazem um campo `type`:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### Cliente → servidor

```
ping                          // batimento
subscribe.conversation        // assinar uma conversa (o servidor confere a condição de participante)
unsubscribe.conversation
typing.start                  // só surte efeito em conversas já assinadas
typing.stop
read.ack                      // confirmação de leitura
```

A difusão de `typing.*` segue o conjunto de assinaturas daquele socket. Quando a assinatura tem portão e os eventos de digitação não têm, basta conhecer o id de uma conversa para injetar nela um «fulano está digitando» — e ainda com o próprio nome de usuário.

### Servidor → cliente

```
pong
message.new                   // mensagem nova
message.updated
message.deleted
typing.update                 // quem está digitando
presence.update               // um contato entra ou sai
permission.request            // um pedido de permissão que o usuário precisa decidir
agent.status                  // o que o meu Agente está fazendo («consultando o Agente da ABC…»)
conversation.updated
```

`message.new` por exemplo:

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
    "content": "Com 0x03, Read Holding Registers…",
    "citations": [
      {
        "source": "Manual de comunicação do X100 v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "pt",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` por exemplo:

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

**Não há `description` no payload, e isso é proposital.** O servidor não sabe em que língua lê quem recebe, então manda apenas fatos estruturados (`action` + a identidade do peer + o `scope` armazenado), e a frase lida na aprovação é montada pelo cliente conforme o seu i18n (`packages/client/src/lib/permission-text.ts`). Esse contrato pertence exclusivamente ao `permissionRequestEventSchema`, em `@confer/shared`: o gateway usa-o para parsear antes de enviar e o cliente para parsear ao receber.

Cada linha de `GET /api/v1/permissions/pending` tem essa mesma forma (com um campo `decision` a mais) e sai do mesmo construtor, de modo que a linha obtida por polling e a empurrada pelo socket coincidem byte a byte.

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

Tipos de evento:

```
event: token
data: {"text":"Com "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"Manual de comunicação do X100 v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## API A2A (para fora, chamada por outras instâncias do Confer)

Veja `docs/03-protocol.md`. Aqui só se listam os endpoints.

Dois bindings convivem sob o mesmo prefixo e compartilham os mesmos portões (`a2a/inbound.ts`); só o formato de fio difere.

**Binding HTTP+JSON padrão do A2A** (os caminhos são copiados tal e qual da §11.3 da especificação, e é este que o Agent Card anuncia):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks (paginação por cursor)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # não implementado → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # não implementado → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # não implementado → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**O dialeto próprio do Confer** (entre instâncias; descoberto por `/.well-known/agents.json`):

```
POST   /a2a/v1/messages                  # recebe mensagens de Agentes externos
GET    /a2a/v1/stream/{message_id}       # puxa a resposta em fluxo (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # AgentFacts público
```

Todos os endpoints A2A exigem verificação da assinatura HTTP da mensagem.

## .well-known endpoints

```
GET    /.well-known/did.json                # documento DID principal
GET    /.well-known/agents.json             # lista de todos os Agentes públicos desta instância
GET    /.well-known/agent-card.json         # Agent Card padrão do A2A (apenas quando a instância tem um único Agente público)
GET    /.well-known/openid-configuration    # no futuro: compatibilidade OIDC (v2)
```

## Agent Card padrão do A2A (camada de descoberta interoperável)

```
GET    /agents/{username}/agent-card.json   # o Card padrão A2A daquele Agente
GET    /.well-known/agent-card.json         # o mesmo, apenas quando esta instância tem um único Agente público
```

Segue o `AgentCard` do **Agent2Agent v1.0** da Linux Foundation (campos tirados de `specification/a2a.proto` de `a2aproject/A2A` @ v1.0.1, com mapeamento JSON do proto3, daí o camelCase). O objetivo é que o ecossistema A2A **descubra** os Agentes desta instância: os nomes batiam, mas os protocolos não se entendiam, porque o documento de descoberta do outro lado fica em `/.well-known/agent-card.json` e esta instância só tinha `/.well-known/agents.json`.

Algumas escolhas deliberadas:

- **Um Card por Agente**, com `supportedInterfaces[].tenant` = nome de usuário. O well-known da especificação pressupõe um Agente por domínio, e esta instância é multi-inquilino; `tenant` é precisamente o seletor de roteamento que a especificação define para «vários Agentes atrás de um mesmo endpoint A2A». `/.well-known/agent-card.json` só responde quando há **exatamente um Agente público** (o caso de quem se auto-hospeda sozinho); caso contrário devolve 404 e aponta para `agents.json` na mensagem de erro — escolher uma conta qualquer e chamá-la de «o Agente deste domínio» seria falso.
- **`streaming: false`**. Endpoints em fluxo existem, sim, mas no formato próprio do Confer, não no `SendStreamingMessage` da especificação. Anunciar uma capacidade que um cliente padrão não consegue usar é pior do que não anunciar nada.
- **Não se declara `securitySchemes`**. O que a especificação oferece ali é chave de API, autenticação HTTP, OAuth2, OIDC ou mTLS, e este endpoint não aceita nenhum: o que ele quer é uma requisição assinada. Preencher um qualquer equivaleria a dizer ao cliente que ele pode se autenticar de um modo que será infalivelmente recusado. A exigência real é declarada como **extensão obrigatória** (`capabilities.extensions`, com o endereço da RFC 9421 em `uri` e `required: true`), que é exatamente o mecanismo que a especificação prevê para isso.
- O Card é um **documento de descoberta** e a sua visibilidade é idêntica à de `/.well-known/agents.json`: um Agente não público ou desativado devolve sempre 404; do contrário esta rota viraria um jeito de enumerar contas que o dono não quis tornar públicas.

- **Anuncia-se um único binding.** O dialeto próprio do Confer vive nesta mesma URL, mas não entra no Card: a §5.1 exige que todos os bindings declarados por um Agente sejam funcionalmente equivalentes, e o dialeto não tem ciclo de vida de tarefas. Ele é descoberto por `/.well-known/agents.json`, e assim o Card não promete nada que não possa cumprir.

### Camada de mensagens (semântica de Task)

`POST /a2a/v1/message:send` recebe o `SendMessageRequest` da especificação e devolve um `Task`. **Uma tarefa é uma pergunta de entrada**: o seu `id` é o id daquela mensagem, o `contextId` é a conversa que a arquiva, e o estado se deduz do que acontece depois — não há uma tabela `tasks` à parte espelhando o mesmo fato.

O modelo assíncrono do Confer, com o seu portão de consentimento, cai exatamente na máquina de estados da especificação:

| Situação | Estado |
|---|---|
| O Agente está respondendo | `TASK_STATE_WORKING` |
| Terminou | `TASK_STATE_COMPLETED` |
| Este turno não consegue nem começar (sem modelo configurado, ou o fornecedor falhou) | `TASK_STATE_FAILED` |
| Suspenso pela política `ask_user`, à espera do dono | `TASK_STATE_AUTH_REQUIRED` (estado de interrupção, não terminal) |
| O dono recusou | `TASK_STATE_REJECTED` |

Há dois casos em que **não** existe tarefa a devolver, porque nenhuma linha chegou a ser criada: o peer desconhecido (que fica como pedido de conexão pendente) e a recusa direta por política. Ambos respondem `403 PERMISSION_DENIED` e se distinguem por `ErrorInfo.metadata.confer_status` — inventar um id de tarefa que daria 404 na chamada seguinte seria pior.

O resto do comportamento acompanha a especificação ponto a ponto: o corpo de erro tem a forma de `google.rpc.Status` e traz **sempre** `ErrorInfo.reason` (vários erros A2A compartilham o mesmo código HTTP, e `reason` é o único campo que os distingue); a um cliente que não declarou a extensão obrigatória responde-se `ExtensionSupportRequiredError`, conforme a §3.3.4, e não um 401 que nada explica; `historyLength=0` significa **omitir o campo inteiro**, não mandar um array vazio; e `nextPageToken` está sempre presente, com string vazia quando não há página seguinte.

Dois desvios deliberados, ambos anotados no código: a espera do `message:send` bloqueante **tem teto** (55 s, após os quais se devolve a tarefa ainda em `WORKING` para o cliente consultar) — a §3.2.2 não oferece saída por tempo, e uma chamada a um LLM não tem cota superior; e a idempotência por `messageId` (um MAY da §3.3.1) **não foi feita**, porque uma chave única segura entre inquilinos precisa do escopo do dono, que o formato de fio da primeira mensagem não traz.

## Webhooks (opcional, v1.5+)

Permitem que sistemas externos assinem eventos:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

Eventos suportados: `message.new.peer`, `permission.granted`, `thread.archived`.

## Política de limite de taxa

| Rota | Limite |
|---|---|
| `/api/v1/auth/login` | 10/minuto por IP |
| `/api/v1/auth/register` | 3/hora por IP |
| `/api/v1/conversations/*/messages` POST | 60/minuto por usuário |
| `/a2a/v1/*` | 100/minuto por domínio de peer (mais na lista branca) |
| WSS | no máximo 10 conexões simultâneas por usuário |

Resposta ao exceder o limite:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## API de consulta (saída A2A iniciada pelo usuário)

Permite que o usuário (ou o servidor MCP que age por ele) pergunte por iniciativa própria a um Agente peer **que já seja seu contato** e depois recolha a resposta assíncrona. A assinatura e a entrega acontecem inteiramente dentro do gateway; a chave privada não sai dele.

> Diferença para a «API de conversas»: `/api/v1/conversations` + `/api/v1/stream` é conversar com **o próprio assistente LLM local**; `/api/v1/consult` é o que vai por A2A para **o Agente de outra pessoa**.

### POST `/api/v1/consult/:peerId`

Abre ou continua uma conversa de `type='consult'` (uma por peer, reaproveitada), e assina e entrega um `message.type='question'`.

```jsonc
// corpo da requisição (consultRequestSchema)
{ "question": "Como se faz a rotação de chaves?", "code_context": "…código opcional…", "language": "pt" }
```

| Resposta | Significado |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | assinada e entregue |
| `502 { ..., status: "failed", error }` | a entrega falhou (peer off-line, sem endpoint, ou problema de assinatura) |
| `403 not_a_contact` | o peer não é contato do usuário atual |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

Espera por long polling a resposta assíncrona do peer (que chega pela entrada `/a2a/v1/messages` com o seu `thread_id`, e o gateway a pendura de volta no fio correspondente). O teto de `wait` é 55 s.

- `200 { status: "answered", message }` — a resposta chegou
- `200 { status: "pending" }` — o tempo esgotou sem resposta; pode-se consultar de novo mais tarde

### GET `/api/v1/consult/:conversationId`

Devolve o histórico completo daquele fio de consulta (no máximo 200 mensagens).

> Contrato: a entrada A2A só dispara a resposta automática do Agente local para `message.type==='question'`; `answer` e `notification` apenas são gravados e difundidos, para que a resposta de uma consulta não desencadeie uma troca sem fim.

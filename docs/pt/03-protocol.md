# Confer — projeto do protocolo

Define todos os protocolos entre instâncias do Confer e entre o cliente do usuário e o servidor. Todos se apoiam em padrões abertos, para facilitar a federação no futuro.

## Identidade do Agente

### Formato DID:web

Cada instância, pessoal ou corporativa, hospeda o próprio documento DID:

```
https://acme.com/.well-known/did.json
```

Estrutura do documento DID (compatível com W3C DID v1.0):

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

O DID do Agente de um usuário tem esta forma: `did:web:acme.com:agents:laowang` — a instância principal mais um segmento de caminho. Assim uma instância pode hospedar vários usuários.

Pela especificação do did:web, um **DID com subidentificador** (isto é, com segmentos de caminho) resolve para o documento correspondente àquele caminho, e **não** para o `.well-known` da raiz da instância:

- `did:web:acme.com:agents:laowang` → `https://acme.com/agents/laowang/did.json` (dois-pontos → barra, e no fim `/did.json`)
- O DID nu da instância, `did:web:acme.com` → `https://acme.com/.well-known/did.json`
- Uma porta de verdade é codificada com `%3A`: `did:web:acme.com%3A3000:agents:laowang` → `https://acme.com:3000/agents/laowang/did.json` (dois-pontos nus como `:8080` são um segmento de caminho, não uma porta)

### Rotação de chaves

- O documento DID aceita declarar vários métodos de verificação, para rotacionar sem interrupção.
- A chave antiga fica pelo menos 30 dias (para não derrubar requisições em voo).
- A revogação é feita removendo o método de verificação do documento.

## AgentFacts (compatível com NANDA)

Cada Agente publica um AgentFacts que o descreve. Localização:

```
https://acme.com/agents/{slug}/agent.json
```

Ou o diretório geral em well-known:

```
https://acme.com/.well-known/agents.json
```

Exemplo de estrutura:

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

Os campos:

- `capabilities`: declara o que este Agente sabe fazer. O Claude Code usa o campo `scope` para rotear por palavra-chave (ao escrever código relacionado ao X100, consulta este Agente automaticamente).
- `languages`: os idiomas suportados. Serve à estratégia de tradução.
- `trust.verifiedBy`: endosso de confiança de terceiros (opcional; a NANDA vai fornecer no futuro).
- `publicKey`: a chave pública de assinatura da comunicação A2A.

## Protocolo A2A

### A camada de protocolo

Toda comunicação A2A vai por HTTPS POST/GET, codificada em JSON. Sob `/a2a/v1` convivem dois vínculos:

- **O vínculo HTTP+JSON do A2A v1.0 da Linux Foundation** (`routes/a2a-rest.ts`), com os caminhos exatamente como estão na §11.3 da especificação: `POST /message:send`, `GET /tasks/{id}` etc. É o que o Agent Card anuncia e o que os clientes padrão chamam. Ver `docs/05-api.md`.
- **O dialeto próprio do Confer** (`routes/a2a.ts`), usado entre instâncias e descoberto via `/.well-known/agents.json`.

Os dois compartilham exatamente as mesmas comportas — verificação de assinatura, comporta de consentimento, decisão de política, pertencimento da thread —, todas em `a2a/inbound.ts`; só muda o formato do fio. **Escrever essas comportas uma vez por vínculo é justamente a razão de o bug de injeção de thread entre inquilinos ter sido escrito quatro vezes**; não as separe de novo.

**O essencial: usa-se HTTP Message Signatures (RFC 9421), não um bearer token.** Por quê:

- Um bearer token está comprometido no instante em que é interceptado.
- Uma assinatura HTTP está atada a uma requisição concreta (método + caminho + query + digest do corpo + carimbo de tempo).
- Contra repetição: o cabeçalho `Date` precisa cair numa janela de 5 minutos, e cada assinatura verificada é anotada num cache de repetição (nonce), de modo que reenviar a mesma requisição dentro da janela é recusado; verificar a assinatura já basta para estabelecer quem enviou.

**Os componentes cobertos pela assinatura** são `@method`, `@authority` e `@path`, mais `@query` quando a requisição traz cadeia de consulta e `content-digest` quando traz corpo, mais `date`. `@query` não é um refinamento opcional: `@path` para no `?`, e o `GET /tasks` do vínculo REST filtra e pagina inteiramente por parâmetros de consulta; não cobri-los equivale a deixar um intermediário reescrevê-los à vontade com a assinatura ainda válida. Os parâmetros da assinatura carregam ainda um `nonce` aleatório por requisição: `created` só tem granularidade de segundos, então duas requisições idênticas no mesmo segundo assinariam os mesmos bytes e o cache de repetição do destinatário as tomaria por ataque (qualquer sondagem de uma task, ou qualquer retentativa, esbarra nisso). Uma repetição de verdade — os mesmos bytes reenviados tal e qual — continua sendo pega, porque a assinatura segue idêntica byte a byte.

**Esta camada não tem os `securitySchemes` da especificação**: aqueles são chave de API, autenticação HTTP, OAuth2, OIDC ou mTLS, e nenhum é assinatura de requisição. O requisito real é declarado no Card como **extensão obrigatória**, e o vínculo REST a impõe conforme a §3.3.4: um cliente que não declare essa extensão recebe `ExtensionSupportRequiredError`, em vez de um 401 que não explica nada.

### Exemplo de requisição de entrada

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
    "content": "Qual é a faixa de tensão do X100 em modo RTU?",
    "language": "pt",
    "context": {
      "via": "claude-code",
      "project_hint": "modbus integration"
    }
  }
}
```

### Fluxo de verificação (no destinatário)

1. Analisar os cabeçalhos `Signature-Input` e `Signature`.
2. Extrair o DID do parâmetro `keyid` de `Signature-Input`.
3. Buscar o documento DID (com cache: ETag + TTL de 60 s).
4. Tirar dele a chave pública, reconstruir a cadeia base da assinatura conforme a RFC 9421 §2.5 e verificar a assinatura.
5. Conferir que o `Content-Digest` bate com o hash do corpo.
6. Conferir que o `Date` está dentro de 5 minutos (antirrepetição).
7. Verificar o token de capacidade (estilo macaroon, detalhado adiante).
8. **Comporta de consentimento da conexão**: o remetente já está nos contatos do destinatário? Se não → o LLM não roda; fica pendente como pedido de conexão (ver adiante).
9. Se sim → segue para o motor de políticas, que decide se responde.

### Token de capacidade

O token de capacidade permite ao Agente remetente declarar "venho em nome do usuário X para perguntar algo do tipo Y", limitando permissões com granularidade fina.

No estilo de um JWT, mas com a ideia das macaroons:

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

- `scope`: que tipo de perguntas pode fazer.
- `delegation_depth`: quantas vezes foi repassado por delegação (para evitar cadeia infinita).

### Resposta em fluxo

O LLM gera a resposta em fluxo, e o A2A também suporta SSE:

```http
GET /a2a/v1/stream/{message_id} HTTP/1.1
Host: acme.com
Signature: ...
```

Devolve `text/event-stream`:

```
event: token
data: {"text": "O X100 "}

event: token
data: {"text": "em modo RTU "}

event: citation
data: {"source": "Manual de instalação do X100 p.12", "url": "..."}

event: done
data: {"thread_id": "thread_8f3a9c"}
```

## Modelo de permissões (inspirado no Claude Code)

Três níveis:

### L1 — automático (sem confirmação)

- Meu Agente lê os meus próprios dados.
- O Agente do outro lado responde citando os documentos dele.
- Conversa entre Agentes puramente consultiva (sem efeito colateral nem compartilhamento de dados).

### L2 — perguntar uma vez

- Compartilhar um diretório ou arquivo com o Agente do outro lado.
- Deixar o Agente do outro lado ver o contexto da minha conversa.
- Repassar dados para outra instância.
- Habilitar uma ferramenta (na primeira vez).

Na interface: aparece um cartão de permissão com quatro opções:
- Permitir desta vez
- Permitir sempre (restrito a esse peer e a esse escopo)
- Ver detalhes
- Recusar

### L3 — consentimento explícito (pergunta sempre)

- Meu Agente aceitar convite, pagar ou assinar contrato em meu nome.
- Operações irreversíveis (excluir, transferir, assumir compromisso com terceiros).
- Compromissos com implicação financeira ou jurídica.

Na interface: janela modal + lista detalhada da operação + contagem regressiva (contra cliques acidentais).

### Políticas permanentes

O usuário pode fixar regras de antemão que sobrepõem o comportamento padrão:

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

### Comporta de consentimento da conexão

Responder a uma mensagem A2A consome o orçamento de LLM **do destinatário**. Para que um Agente desconhecido não possa mandar mensagens à vontade e queimar os tokens do dono sem que ele saiba, estar conectado é condição prévia a esse gasto:

- **Peer já conectado** (presente nos `peer_contacts` do destinatário) → a conexão é o consentimento; segue para o motor de políticas e o processamento corre normalmente.
- **Peer não conectado** → `POST /a2a/v1/messages` devolve `202` com corpo `{ "status": "pending_connection" }`; **nenhuma conversa é criada, nenhuma mensagem é gravada e nenhum LLM é executado**. Ao mesmo tempo, um pedido de conexão com `action='connect'` é deixado na caixa de pendências (deduplicado por peer, para que mensagens repetidas não a inundem).
- O dono vê na caixa de permissões "tal Agente pede conexão + a primeira mensagem dele". Se **aprova**, grava-se em `peer_contacts` (a conexão está feita) e dali em diante as mensagens daquele peer são processadas normalmente; se **recusa**, nenhuma conexão é estabelecida.

O modelo lembra o do LinkedIn ou o de uma federação de empresas: **camada de descoberta aberta** (qualquer um pode ler `agents.json` e os AgentFacts) e **camada de interação sob consentimento** (só se consome computação alheia depois de conectar).

Há dois caminhos até o estado "conectado":
1. O destinatário adiciona o peer por conta própria, com `POST /contacts/lookup` → `POST /contacts`.
2. O peer toma a iniciativa e o destinatário aprova o pedido pela caixa.

### Vinculação da thread (o escopo de `thread_id`)

O `thread_id` de uma mensagem de entrada é um **pedido** do peer, não uma instrução com autoridade. O gateway só o reaproveita **com o valor original** quando duas condições valem ao mesmo tempo:

1. Esse peer já é participante daquela conversa.
2. Aquela conversa **pertence ao dono do Agente endereçado** (`conversations.created_by`).

A segunda não pode ser omitida: `peer_agents` é único globalmente por DID, então um mesmo peer pode estar conectado a vários donos. Checando só a primeira, um peer conectado a A e a B poderia, ao escrever para o Agente de B, anexar o `thread_id` de A e despejar a mensagem na conversa de A: o Agente de B responderia tomando o histórico de A como contexto, a resposta seria gravada na thread de A e transmitida para A, e ainda por cima o conteúdo da conversa de A acabaria sedimentado na memória de longo prazo de B.

Se as duas valem, é porque o outro lado está respondendo a uma mensagem que saiu daqui (e aí o `thread_id` é o id da nossa própria conversa). Quando não valem, trata-se de **uma thread na numeração do próprio peer**: aqui não aponta para nada, mas para o peer é estável, então o nosso id de conversa é derivado de `sha256('a2a-thread:<id do dono>:<id da linha do peer>:<thread_id do peer>')` (`lib/derived-id.ts`, que devolve 26 caracteres Crockford, com a mesma forma de um ULID). Assim as mensagens seguintes daquela mesma thread do peer sempre caem na mesma conversa.

Antes, um `thread_id` desconhecido era tratado como "não há thread", e o destinatário **criava uma conversa a cada mensagem recebida**: a repergunta nunca ficava junto da pergunta original, a lista de conversas do dono enchia de threads de uma linha só, `loadA2AHistory` não achava histórico, e o Agente respondia a cada turno como se fosse a primeira vez.

Derivar em vez de "guardar uma tabela de correspondência" tem duas vantagens: dispensa migração e não admite corrida — duas mensagens simultâneas colidem na chave primária em vez de criarem uma conversa cada (por isso a criação vai numa transação com `onConflictDoNothing`). Na cadeia concatenada, só o **último** segmento pode ter comprimento variável e estar sob controle do peer; os anteriores são ids de 26 caracteres fixos, de modo que os dois-pontos sem escape não geram ambiguidade.

Ao criar a conversa, **o dono e o peer** são gravados juntos em `conversation_participants`. A linha de participante do dono é o que sustenta a lista de conversas e a comporta de leitura conversa a conversa; sem ela, o dono não veria a thread que o próprio Agente está respondendo.

O `thread_id` é, portanto, **o id de conversa de cada lado**, e não coincide entre os dois. Daí saem duas regras que não se pode pular:

- **A resposta precisa devolver o `thread_id` enviado por quem perguntou, não o próprio.** A condição 2 acima recusaria (com razão) uma thread que não lhe pertence, então uma resposta que viaje com o nosso id de conversa é arquivada pela outra ponta numa conversa inteiramente nova; quem perguntou continua sondando a que criou, e `/api/v1/consult/{id}/reply` fica para sempre em `pending`, enquanto há uma resposta perfeitamente boa nas duas máquinas.
- **Em `messages.thread_root` grava-se o id da conversa local, jamais o valor cru do peer.** Essa coluna é `char(26)`, feita para os nossos próprios ULIDs: guardar um valor alheio apontaria para uma conversa que talvez nem seja nossa, e ainda deixaria qualquer peer derrubar o endpoint com um 500 mandando um `thread_id` de mais de 26 caracteres. O `thread_id` de entrada tem, além disso, validação de comprimento.

### Não conseguir responder também é uma resposta

Quando o Agente destinatário não consegue rodar o turno (sem modelo configurado, provedor desconhecido, provedor configurado mas sem chave, ou a chamada ao modelo lançou erro), ele devolve um `type: 'notification'` cujo `context.error` traz um código legível por máquina (`no_model_configured` / `unknown_provider` / `no_key_for_provider` / `agent_error`), e cujo `content` é uma frase explicativa em inglês. Usa-se `notification` porque ela não dispara outra resposta automática na outra ponta (só `question` dispara).

Não fazer isso não significa "faltou um aviso": a falha se resume a uma linha de log em quem responde, nada sai pelo fio, e o `/api/v1/consult/{id}/reply` de quem perguntou fica sondando até o prazo e devolve `pending` — igual em toda retentativa, **sem nenhuma forma de distinguir "ainda está pensando" de "nunca vai chegar"**.

A outra ponta é outra instância e não compartilha o nosso idioma, então o critério é o código de `context.error`; o `content` é só o texto legível de reserva. Isso não contradiz a regra de "o servidor não redige texto para o usuário": aquela regula o que sai para **o cliente desta mesma instância**.

**Essa mesma falha também é gravada**, como uma mensagem com `content_type: 'system_notice'` dentro da conversa (`in_reply_to` aponta para a pergunta, `content_json` traz o mesmo código, e o cliente redige a frase por i18n). Mandar sem gravar tem três consequências, e as três já aconteceram: o dono vê no mensageiro a pergunta do outro lado seguida de nada, sem jamais descobrir que era ele quem não tinha modelo configurado; a task do vínculo REST do A2A fica em `WORKING` em vez de `FAILED`, e o cliente sonda algo que nunca termina; e `GET /a2a/v1/stream/{id}` devolve `pending` sem fim. Com essa nota, os três passam de uma vez a um estado final decidível.

### Endereçamento: dois DIDs apontam para o mesmo Agente

`to` aceita tanto o **DID do Agente** (`did:web:<host>:agents:<user>:agent`, que é o que aparece no diretório público `/.well-known/agents.json`) quanto o **DID do dono** (`did:web:<host>:agents:<user>`). Este último é o único identificador que resolve para um documento DID, e é o que o cliente mostra ao usuário para copiar: aceitar só o primeiro faz com que "adicionar contato colando o DID" produza um contato que conecta, cuja assinatura confere, e que responde 404.

Pelo mesmo motivo, ao decidir se o peer remetente está conectado é preciso aceitar tanto o `from` (DID do Agente) quanto o **DID do assinante obtido na verificação** (DID do dono): em `peer_agents` a linha é criada por DID, e qual dos dois ficou guardado depende de como o contato foi adicionado na época; aceitar só o `from` transforma a resposta do outro lado em "um pedido de conexão de um estranho".

### Caixa de pendências (responder na ausência)

Quando chega a pergunta de um peer **já conectado** e o dono não está, quem decide é o motor de políticas (`evaluatePolicy`, action=`ask`, L2):

- `allow` (o padrão, já que a conexão é o consentimento) → o Agente responde direto (`201` + laço de resposta automática).
- `ask_user` (o dono definiu explicitamente `policies_json.default='ask_user'`, ou uma regra `{action:'ask',decision:'ask_user'}`) → **já implementado**: a pergunta de entrada é gravada e transmitida do mesmo jeito (o dono a vê no mensageiro), mas **sem resposta automática**; uma permissão pendente com `action='ask'` é deixada na caixa, e `POST /a2a/v1/messages` devolve `202 { "status": "pending_approval", "message_id" }`. O dono vê a pergunta em `GET /permissions/pending`; se em `POST /permissions/{id}/decide` decidir `allow_*`, o Agente responde em seu nome (resposta com `in_reply_to` + entrega de saída); se decidir `deny`, nada é respondido. Do lado do peer, `GET /a2a/v1/stream/{message_id}` devolve `status:'pending'` até a aprovação, e depois a resposta.
- `deny` (regra de recusa explícita) → `403 policy_denied`.

> **O que uma resposta A2A pode fazer**: a resposta A2A de entrada e o chat web passam pela **mesma orquestração compartilhada** (`runAgentTurn`, em `orchestration/agent-orchestrator.ts`), mas **não têm as mesmas capacidades**. `runAgentTurn` recebe um `audience` obrigatório (`'owner' | 'peer'` — obrigatório e sem valor padrão, porque o valor padrão seria justamente o permissivo), e é ele que determina tanto o conjunto de ferramentas quanto a superfície de dados alcançável:
>
> - **Turno do dono** (chat web): `web_search`, `search_knowledge_base` (todas as bases), `list_knowledge_bases`, `search_memory`, `list_contacts`, com recuperação automática da memória de longo prazo.
> - **Turno de peer** (resposta A2A de entrada): só `web_search`, `search_knowledge_base` e `list_knowledge_bases`, e a busca fica **restrita** às bases marcadas como `shared_with_peers`; **sem recuperar memória de longo prazo**, e sem oferecer `search_memory` nem `list_contacts` — a primeira guarda fatos sedimentados das conversas privadas do dono, e a segunda é o grafo social dele; responder à pergunta de um estranho não precisa de nenhuma das duas.
>
> A fronteira está na **superfície de dados**, não no prompt: a pergunta do peer e as instruções do dono chegam ao modelo como o mesmo tipo de texto, então "o Agente vai se recusar a revelar" não se sustenta; só se sustenta o fato de a busca não conseguir alcançar aquilo fisicamente. Pelo mesmo motivo, **não oferecer uma ferramenta não é controle de acesso**: o modelo pode emitir uma chamada para um nome de ferramenta que nunca lhe foi dado, e por isso os ramos exclusivos do dono reconferem o `audience` dentro de `executeToolCall`.
>
> Os dois tipos de turno usam a chave **do dono**, não a do peer que pergunta. Os trechos de base de conhecimento acertados são persistidos como **citações** em `messages.citations_json`, e ao final os fatos do turno são sedimentados de forma assíncrona na memória de longo prazo (as linhas vindas de um turno de peer ficam marcadas como `a2a`, e a origem é indicada na recuperação). Se o dono não tem chaves de embedding, base de conhecimento ou Tavily, degrada com elegância para uma resposta puramente de LLM (sem erro e sem citações). O caminho de resposta do `allow` e o de um `ask_user` aprovado compartilham esta mesma orquestração.

> O `scope_json` da permissão pendente com `ask='ask'` tem a forma `{ kind:'a2a_question', conversation_id, inbound_message_id, sender_did, peer_id, content }`, o bastante para reconstruir e retomar a resposta na aprovação (agente e peer são relidos na hora por `user_id`/`peer_id`; é idempotente: se já houver resposta, pula). A interface para configurar políticas permanentes, a opção de "editar e responder" e as notificações push continuam no backlog.

## Descoberta federada

### Busca por domínio

Dado o domínio `acme.com`, o cliente:

1. Busca `https://acme.com/.well-known/did.json` para obter o DID principal.
2. Busca `https://acme.com/.well-known/agents.json` para listar todos os Agentes públicos daquele domínio.
3. Escolhe um e adiciona como contato.

### Resolução do DID de um usuário

De posse do DID com subidentificador do Agente de um usuário, o documento DID dele resolve conforme a especificação do did:web:

- `did:web:acme.com:agents:laowang` → `GET https://acme.com/agents/laowang/did.json`
- O DID nu da instância, `did:web:acme.com` → `GET https://acme.com/.well-known/did.json`

A verificação de assinatura do A2A de entrada segue exatamente esse caminho: extrai o DID do assinante do `keyid` de `Signature-Input` → resolve para a URL acima → pega em `verificationMethod` a chave pública que casa com o `keyid` e verifica. Esse documento só expõe material de chave pública, e `verificationMethod[*].id` é o `key_id` armazenado (não é recomposto a partir do Host da requisição), de modo que o id obtido resolvendo de outra instância e o obtido localmente são sempre o mesmo.

### Registro público (v2 em diante)

Conectar ao NANDA Index ou a um registro público equivalente, com suporte a:

- Busca por capacidade ("acha um Agente que entenda de Modbus").
- Busca por organização ("o Agente da ABC Industries").
- Busca por localização ("Agentes de serviço perto de mim").

### Grafo de confiança (v2 em diante)

- Os Agentes dos meus contatos vêm primeiro.
- Os Agentes da empresa dos meus colegas vêm primeiro.
- Endossos de terceiros (verificados pela NANDA) ganham selo de confiança.

## Antispam

- Limitação de taxa por domínio de peer e por minuto (contador em memória do processo; o gateway é de instância única).
- Peers fora da lista branca têm baixa prioridade por padrão.
- O usuário pode bloquear um domínio de peer.
- Pontuação de reputação (v2 em diante): quantas outras instâncias já o marcaram como spam.

## Estratégia de tradução

- Cada Agente declara nos seus AgentFacts um `primary_language` e um `style`.
- Numa conversa entre idiomas, a tradução acontece **dentro do Agente de destino** (é ele quem melhor conhece a própria terminologia e os próprios documentos).
- A parte citada **preserva sempre o original**: o usuário pode consultar a formulação com autoridade, antes da tradução.
- O comportamento padrão é `preserve-style` (preserva o estilo e só troca o idioma); um cenário de consumo pode declarar `localize-style` (adaptar-se aos costumes locais).

## Estratégia de evolução do protocolo

- Todos os protocolos trazem um campo `@context` ou `version`.
- Cliente e servidor mantêm compatibilidade retroativa (aceitam e ignoram campos desconhecidos).
- Quebras de compatibilidade passam por incremento de versão maior (por exemplo `/a2a/v2/`).
- Compatível com a evolução de esquemas da NANDA e do A2A do Google (apostamos no ecossistema aberto).

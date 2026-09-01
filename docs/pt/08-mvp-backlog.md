# Confer — Roteiro do MVP e pendências

Fatiado por marcos; cada marco é uma versão entregável e demonstrável.

## v0.1 — Core proof of concept (4-6 semanas)

**Objetivo**: fazer uma única máquina rodar de ponta a ponta a cadeia «usuário ↔ o próprio Agente ↔ Agente alheio».

**Escopo (obrigatório)**

- [x] backend: gateway + agent runtime + conversation + identity (quatro serviços, num processo só ou separados, tanto faz)
- [x] esquema do PostgreSQL (veja 04-data-model.md), gerido por uma ferramenta de migrações
- [x] cadastro e login de usuários (senha basta; nada de OAuth nem passkey)
- [x] geração e publicação do documento DID:web (`/.well-known/did.json`)
- [x] geração e publicação do documento AgentFacts
- [ ] protocolo A2A de entrada e de saída (verificação de assinatura HTTP + verificação do capability token)
- [x] agent runtime: o laço de chamadas ao LLM (por ora só dois fornecedores, Claude e DeepSeek)
- [x] motor de políticas simples: peers em lista branca, com tudo liberado ou tudo negado
- [x] cliente: um único aplicativo Tauri, primeiro os três desktops (Linux / macOS / Windows; o celular depois)
- [x] que o cliente consiga: entrar, adicionar contatos (por DID), conversar um a um e ver as citações
- [x] envio de mensagens em tempo real por WebSocket (uma instância basta; sem fan-out por NATS)
- [x] saída do LLM em fluxo por SSE
- [x] ambiente de desenvolvimento local num comando com Docker Compose

**Out of scope**:

- grupos, fan-out para vários dispositivos, celular, interface multilíngue, CDN, OAuth externo, políticas complexas
- o plugin do Claude Code ainda não entra neste lote

**Acceptance**:

Duas pessoas sobem cada uma a sua instância local do Confer, adicionam-se mutuamente, conversam e veem as citações.

---

## v0.2 — MVP do plugin do Claude Code (3-4 semanas)

**Objetivo**: poder consultar um Agente peer dentro do Claude Code, e a resposta se depositar no projeto.

**Scope**:

- [x] implementar o servidor MCP, com quatro ferramentas: `ask_peer`, `list_peers`, `read_project_memory` e `write_project_memory`
- [ ] vincular a conta do Confer à instância do Claude Code, ao estilo OAuth
- [ ] análise do arquivo de configuração `.claude/confer.toml`
- [ ] leitura e escrita do diretório `.claude/peers/{slug}/` (facts.md, decisions.md, conversations/, meta.json)
- [ ] extração automática de fatos: depois de ask_peer, tirar da resposta os fatos estruturados e escrevê-los em facts.md
- [ ] a ferramenta de linha de comando `confer` (add peer, list peers, ask, sync)
- [ ] um Agente peer de demonstração (mock-vendor.confer.dev) para se poder testar

**Acceptance**:

Alguém instala `claude mcp add confer`, configura, e do Claude Code consegue perguntar ao mock vendor; a resposta vem com citações, é escrita em `.claude/peers/mock-vendor/facts.md`, vai para o git num commit e na sessão seguinte carrega sozinha.

---

## v0.3 — Grupos e instâncias corporativas (4-5 semanas)

**Objetivo**: dar conta de conversas em grupo (pessoas e Agentes misturados) e permitir implantar uma «instância corporativa» numa máquina.

**Scope**:

- [ ] modelo de dados e interface dos grupos
- [ ] gestão dos membros do grupo (adicionar e remover pessoas e Agentes)
- [ ] vários Agentes mencionados respondem ao mesmo tempo (exibição recolhida, com mecanismo de «adotar»)
- [ ] instância corporativa: domínio próprio e login por SSO (OIDC basta)
- [x] descoberta de contatos: busca por domínio (digitando acme.com acham-se os Agentes que aquele domínio publica)
- [ ] fan-out para vários dispositivos (entra o NATS)
- [ ] celular (iOS, Android)

**Acceptance**:

Uma equipe de cinco pessoas mais dois Agentes toca a discussão de um projeto num mesmo grupo, com fluidez. Uma empresa consegue montar a própria instância do Confer, publicar Agentes para fora e ser encontrada por outras instâncias.

---

## v0.4 — Multilíngue e resposta em diferido (3 semanas)

**Objetivo**: tornar o produto útil em cenários internacionais e de comunicação semiassíncrona.

**Scope**:

- [x] i18n da interface (chinês e inglês para começar, guardando espaço para japonês, alemão e francês)
- [ ] conversa entre Agentes de línguas diferentes (a tradução acontece dentro do Agente de destino, e a citação preserva o original)
- [ ] acrescentar o campo `primary_language` ao AgentFacts
- [ ] resposta em diferido: interface para definir a standing policy, caixa de pendências e notificações push
- [x] acrescentar ao servidor MCP a ferramenta de pre-flight design review
- [x] acrescentar ao servidor MCP a ferramenta de post-flight code review

**Acceptance**:

Alguém na China pergunta em chinês ao Agente de um fabricante alemão (documentação em alemão) e recebe a resposta em chinês com a citação no alemão original. Definida a standing policy, o Agente atende corretamente, na ausência do dono, os pedidos que se encaixam na regra, e deixa os duvidosos pendentes.

---

## v1.0 — Pronto para produção (4-6 semanas)

**Objetivo**: poder servir em produção, com suporte comercial.

**Scope**:

- [ ] observabilidade completa (tracing OTel, métricas Prometheus, logs Loki)
- [ ] backup e restauração (backup físico do PG + incremental para S3)
- [x] auditoria de segurança (as operações críticas deixam audit log)
- [ ] limites de taxa refinados (as quatro dimensões)
- [ ] painel de consumo de LLM (custo mensal por Agente)
- [ ] experiência completa de BYO LLM key (armazenamento cifrado, rotação, cota)
- [x] site de documentação (manual de uso, manual de auto-hospedagem, referência da API)
- [ ] entrada no ar da instância pública Confer Cloud (`cloud.confer.ai`)

**Acceptance**:

Pelo menos 100 usuários cadastrados, 10 Agentes peer implantados de forma independente, e uma instância rodando estável por mais de 30 dias.

---

## v1.5+ — Crescimento e ecossistema (contínuo)

**Scope**:

- [ ] diretório público de Agentes (ligado ao NANDA Index)
- [ ] grafo de confiança e sistema de reputação
- [ ] versão de consumo para pessoas físicas (interface mais leve)
- [ ] antispam baseado em reputação
- [ ] webhooks (integração com sistemas de terceiros)
- [ ] vários Agentes por usuário (uma pessoa com vários Agentes especializados)
- [ ] extensão de navegador (chamar o Agente numa página web)

---

## Granularidade das tarefas (para o Claude Code)

Cada marco se desdobra em 50 a 200 tarefas pequenas. Cada tarefa:

1. tem entradas e saídas claras
2. tem critérios de aceitação testáveis
3. não passa de um dia-pessoa de trabalho

Por exemplo, algumas tarefas da v0.1:

### Esqueleto do backend

- [x] criar o monorepo (workspaces do pnpm ou do Bun)
- [x] `packages/shared`: definições de tipos compartilhadas (com zod ou valibot)
- [x] `packages/gateway`: esqueleto da aplicação Bun + Hono
- [x] `packages/agent-runtime`: esqueleto da máquina de estados do Agente
- [x] ~~`packages/conversation`: serviço de armazenamento e envio de mensagens~~ — absorvido pelo gateway (`ws/handler.ts` + `routes/conversations.ts`); o pacote separado não tinha um único consumidor, e foi removido em 2026-08-07
- [x] `packages/identity`: DID + AgentFacts + verificação A2A
- [x] ferramenta de migrações do PostgreSQL (drizzle-kit ou prisma)
- [x] criar os arquivos de migração de todas as tabelas

### Camada de banco de dados

- [x] CRUD de User (cadastro, login, consulta do perfil)
- [x] CRUD de Agent (criar o próprio Agente, mudar a configuração)
- [x] CRUD de PeerAgent (adicionar, consultar e apagar contatos)
- [x] CRUD de Conversation e gestão de Participant
- [x] CRUD de Message e paginação
- [x] escrita e consulta da tabela Permission

### Identidade e protocolo

- [x] geração do documento DID (um par de chaves ed25519 por usuário)
- [x] `/.well-known/did.json` endpoint
- [x] geração de AgentFacts e o respectivo endpoint
- [x] assinador de assinaturas HTTP (saída)
- [x] verificador de assinaturas HTTP (entrada)
- [ ] emissão e verificação de capability tokens
- [x] buscador de documentos DID + cache

### Abstração do LLM

- [x] interface de fornecedor de LLM (chat, stream, tools)
- [x] implementação do fornecedor Claude
- [x] implementação do fornecedor DeepSeek
- [x] armazenamento cifrado das chaves de API (Vault / env)
- [x] aplicar a configuração de modelo de cada Agente

### Agent runtime

- [x] máquina de estados do Agente: laço load → process → save
- [x] laço de chamadas ao LLM com tool calling
- [x] motor de políticas simples (lista branca + allow/deny)
- [x] chamada A2A de saída (o Agente manda mensagem a outro)
- [x] tratamento A2A de entrada (chega mensagem do Agente de outra pessoa)

### Gateway e API

- [x] middleware de emissão e verificação de JWT
- [x] todos os endpoints `/api/v1/auth/*`
- [x] todos os endpoints `/api/v1/conversations/*`
- [x] handler de WebSocket (assinar, enviar mensagens)
- [x] handler de SSE (saída do LLM em fluxo)
- [x] endpoints A2A de entrada + middleware de verificação de assinatura
- [x] middleware de limite de taxa (primeiro a versão simples: janela fixa)

### Cliente

- [x] inicializar o projeto Tauri 2.0
- [x] páginas de login e cadastro
- [x] tela principal: lista de contatos à esquerda, conversa à direita
- [x] janela de adicionar contato (por DID ou por domínio)
- [x] lista de mensagens da conversa (renderização em fluxo)
- [x] renderização das cápsulas de citação
- [x] renderização do cartão de pedido de permissão
- [x] gestão da conexão WebSocket
- [ ] cache local em SQLite das últimas 100 mensagens

### Conteúdo de demonstração

- [ ] implantar o Agente do mock-vendor (para a demo)
- [ ] manual simulado do X100 (algumas páginas em PDF como dados de RAG)
- [ ] vídeo ou documento de demonstração: o percurso completo, de adicionar um contato até obter a resposta

---

## Riscos e decisões antecipadas necessárias

| Risco | Mitigação |
|---|---|
| O SDK do MCP ainda evolui e sua API pode quebrar | Fixar na versão estável, acompanhar o changelog, fazer uma camada de adaptação |
| O protocolo A2A (Google) e o padrão NANDA também ainda evoluem | Começar pelo subconjunto mínimo, guardando espaço para uma camada de adaptação do protocolo |
| O Tauri 2.0 em iOS e Android é relativamente novo e pode reservar surpresas | Na fase de MVP, só os três desktops; o celular na v0.3 |
| O custo do LLM sai do controle | Cota padrão + BYO key explícita + painel de consumo cedo |
| Os SDK dos fornecedores de LLM chineses (DeepSeek/Qwen) não são estáveis | Usar a interface compatível com OpenAI (todos esses fornecedores oferecem) como ponto de entrada único |

## Orientações de implementação para o Claude Code

1. **Testes unitários antes da integração**: cada serviço precisa passar nos próprios testes sem depender de os outros estarem no ar
2. **As migrações de banco vão pela ferramenta de migrações**, nada de SQL na mão
3. **Os tipos se compartilham pelo pacote `@confer/shared`**, servindo a cliente e servidor
4. **Todo PR leva sua mudança de documentação** (se mexeu no protocolo ou na API)
5. **Para implementar o protocolo A2A, prefira uma biblioteca pronta** (por exemplo o pacote npm `http-message-signatures`) a reinventar a roda
6. **Para DID:web, prefira `did-resolver` + `did-jwt`**, que são ferramentas do W3C
7. **Para o servidor MCP, prefira o SDK oficial** (`@modelcontextprotocol/sdk`)
8. **Escreva o assunto do commit como uma frase que diz o que a mudança faz**, não como um prefixo convencional. Atenção: `.github/scripts/gen-release-notes.sh` só reconhece prefixos do tipo `feat:` / `fix:`, então as notas de versão têm de ser escritas à mão — de assuntos em prosa ele não gera

# Confer — implantação e auto-hospedagem

Como rodar você mesmo uma instância completa do Confer — no seu notebook para experimentar, ou num servidor para compartilhar com outras pessoas. Tudo aqui é um caminho real e testado; nada é aspiracional.

> **Escopo:** este guia cobre a instalação **auto-hospedada de instância única**, com ou sem TLS (veja [Servir HTTPS](#servir-https) mais abaixo). Hospedagem pública multi-inquilino e endurecimento da federação estão fora do escopo da v0.1 — veja `docs/02-architecture.md` para a direção arquitetural.

## O que você ganha

Um único comando sobe a plataforma inteira:

| Serviço | Imagem / build | Papel |
|---------|---------------|------|
| `client` | construída a partir de `infra/client.Dockerfile` | interface web + proxy reverso nginx (a única porta exposta) |
| `gateway` | construída a partir de `infra/gateway.Dockerfile` | API Hono, endpoints A2A, WebSocket — **réplica única, veja abaixo** |
| `migrate` | de uso único | roda as migrações do Drizzle e encerra |
| `postgres` | `postgres:18-alpine` | armazenamento de dados principal |
| `qdrant` | `qdrant/qdrant:v1.19.0` | busca vetorial para a base de conhecimento RAG |
| `minio` | `minio/minio` | armazenamento de arquivos compatível com S3 |

> **Não escale `gateway` além de uma réplica.** As conexões WebSocket, os nonces anti-replay do A2A e os contadores de limite de taxa vivem na memória daquele processo. Uma segunda réplica aceitaria requisições A2A repetidas (sua tabela de nonces está vazia), perderia os envios WS dos usuários conectados à outra réplica, e multiplicaria os limites de taxa pelo número de réplicas. Veja em `docs/02-architecture.md` o que precisa mudar primeiro.

O nginx (dentro de `client`) serve a SPA na porta **80** e faz proxy reverso de `/api`, `/ws`, `/a2a` e `/.well-known` para o gateway. A porta própria do gateway (3000) **não** é publicada em produção: tudo passa pelo nginx na 80.

## Pré-requisitos

- **Docker** com Compose v2 (`docker compose`, não `docker-compose`). O único requisito indispensável.
- **Node 18+** — só para `npx confer-cli` (opção A). O caminho de Compose puro, também na A, dispensa.
- Cerca de 4 GB de RAM livre e 2 GB de disco para imagens e volumes.
- [Bun](https://bun.sh) ≥ 1.1 — só se quiser o fluxo de desenvolvimento com recarga a quente (opção C abaixo) ou regerar migrações.

## A. Imagens publicadas (recomendado)

Nada para clonar, nada para construir:

```bash
npx confer-cli
```

O [`confer-cli`](https://www.npmjs.com/package/confer-cli) se recusa a iniciar se o Docker não estiver realmente rodando; escreve `docker-compose.ghcr.yml` e um `.env` com permissão `0600` em `~/.confer` — `JWT_SECRET`, `ENCRYPTION_KEY` e as senhas do banco e do armazenamento de objetos, todas geradas com `crypto.randomBytes` na primeira execução e reaproveitadas depois —, baixa as imagens, aplica as migrações e consulta `/health` por até três minutos. Ele informa sucesso quando uma página é servida, não quando os contêineres sobem; se isso nunca acontecer, imprime as últimas 40 linhas dos logs de `migrate` e de `gateway`. `npx confer-cli down` para tudo mantendo os dados, e `npx confer-cli logs` acompanha o gateway.

Opções: `--port` (padrão 80), `--dir` (padrão `~/.confer`), `--version` (tag da imagem), `--project` (nome do projeto do compose). Se já existir um projeto de compose chamado `confer` que esta CLI não criou, ela para em vez de adotá-lo: os volumes do compose são indexados pelo nome do projeto, então iniciar apontaria estas imagens para o banco daquela outra pilha.

O mesmo à mão, para um host sem Node:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

Isso deixa `POSTGRES_PASSWORD` e `MINIO_ROOT_PASSWORD` nos padrões do arquivo de compose (`confer` / `confer-secret`), que a CLI teria sorteado. Nenhuma das duas portas é publicada, então não é um buraco numa máquina de um único inquilino — mas defina as duas no `.env` em qualquer host compartilhado.

`ghcr.io/hyhmrright/confer-gateway` e `-client` são construídas para linux/amd64 e linux/arm64 a cada push na `main`, e marcadas como `latest`, com o SHA do commit e com a versão da release. Fixe uma com `CONFER_VERSION` no `.env`.

Diferente de `docker-compose.prod.yml`, este arquivo roda `migrate` e `gateway` a partir da *mesma* imagem. Isso só é seguro porque aqui nada é construído — veja o aviso da opção B, que é onde as duas podem divergir.

Depois abra **http://localhost**, cadastre a primeira conta e adicione uma chave de API de LLM em **Configurações** — os mesmos três passos listados na B abaixo.

Tudo daqui em diante que disser `-f docker-compose.prod.yml` vale igual com `-f docker-compose.ghcr.yml`, executado de onde aquele arquivo estiver (`~/.confer`, se a CLI o colocou lá), exceto a atualização: não há nada para reconstruir, então atualizar é rodar `npx confer-cli` de novo, ou `docker compose -f docker-compose.ghcr.yml pull && … up -d`.

## B. Construir a partir de um clone

Use isto para rodar uma árvore modificada, ou para se auto-hospedar sem depender do GHCR:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

A primeira construção leva alguns minutos. Quando terminar:

1. Abra **http://localhost**.
2. Clique em **Cadastrar** (o rótulo aparece no seu próprio idioma) e crie a primeira conta. (O cadastro é limitado a 3 tentativas por hora por IP.)
3. Vá em **Configurações** e adicione uma chave de API de LLM (Claude / OpenAI / DeepSeek / Qwen / Ollama). As chaves são cifradas em repouso com `ENCRYPTION_KEY` (AES-256-GCM) e nunca são enviadas ao cliente.

### Conferir se está saudável

```bash
docker compose -f docker-compose.prod.yml ps        # todos os serviços "running"/"healthy"; migrate fica "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### Configuração

O `.env` comanda a pilha de produção. Os padrões do `.env.example` funcionam para uso local mas são **inseguros**: troque os segredos antes de expor a instância a mais alguém.

| Variável | Padrão (`.env.example`) | Notas |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **Troque.** Assina os tokens de sessão dos usuários. |
| `ENCRYPTION_KEY` | 64 zeros | **Troque.** Precisa ter 32 bytes em 64 caracteres hexadecimais. Gerar: `openssl rand -hex 32`. Cifra as chaves de LLM guardadas. |
| `POSTGRES_PASSWORD` | `confer` (padrão do compose) | Senha do banco de dados. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | Credenciais do armazenamento de objetos. |
| `EXPOSE_PORT` | `80` | Porta do host à qual a interface web se prende. Use por exemplo `8080` se a 80 estiver tomada. |
| `TAVILY_API_KEY` | vazio | Alternativa opcional para a busca na web; uma chave por usuário nas Configurações tem precedência. |
| `ADMIN_USERNAMES` | vazio | Nomes de usuário separados por vírgula, promovidos sozinhos ao papel `admin` na subida do gateway. As contas já precisam estar cadastradas. Os administradores entram com a senha normal da conta e ganham o painel de administração; de lá podem promover outras pessoas. |

> Chaves de LLM, de embedding e da Tavily **não** ficam no `.env`: vivem cifradas por usuário no banco e são configuradas pela interface de Configurações. As chaves do `.env` são segredos de infraestrutura e nada mais.

Depois de editar o `.env`, aplique com:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Atualizar

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate roda de novo sozinho
```

### Zerar (apaga todos os dados)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v apaga também os volumes
```

## C. Desenvolvimento local (recarga a quente)

Rode só a infraestrutura no Docker e o código da aplicação com o Bun:

```bash
bun install
docker compose up -d            # só infraestrutura — Postgres, Qdrant, MinIO (portas publicadas no localhost)
bun run db:migrate
bun run dev                      # gateway na :3000, cliente (Vite) na :1420
```

- Prévia web: **http://localhost:1420** (o Vite faz proxy de `/api` → gateway na :3000).
- Aplicativo de desktop nativo: `cd packages/client && bunx tauri dev`.

O `docker-compose.yml` de desenvolvimento publica cada porta de infraestrutura no localhost (5432, 6333, 6334, 9000/9001) para que o gateway rodando localmente as alcance. Veja o `CONTRIBUTING.md` para o fluxo completo de desenvolvimento e a pilha de testes isolada.

## Conectar o plugin do Claude Code

O plugin `confer-a2a` fala com o gateway por HTTP. **Aponte-o para a URL certa conforme a sua instalação:**

| Sua instalação | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| Imagens publicadas ou um clone (opções A/B) | `http://localhost` (nginx na porta 80; a 3000 do gateway não é publicada) |
| Desenvolvimento local (opção C) | `http://localhost:3000` (o padrão) |
| Instância remota | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # faça bater com a tabela acima
```

Os Agentes peer que você consultar já precisam ser **contatos** da sua conta (adicionar um contato é o portão do consentimento). Referência completa do plugin: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md).

## Os aplicativos de desktop e móvel

A versão web nunca precisa de um endereço: o nginx a serve e faz proxy de `/api` e `/ws` na
mesma origem. Um aplicativo de desktop ou Android empacotado é diferente — ele serve os
próprios recursos a partir de `tauri://localhost` (escrito `http://tauri.localhost` no Windows,
Linux e Android), onde um `/api/v1` relativo resolve para o próprio pacote. É preciso dizer a
ele a qual instância pertence, e só quem fez a implantação sabe disso.

Na primeira execução, a tela de login traz um campo extra, **Endereço da instância**. Preencha
como na tabela acima:

| Sua implantação | O que digitar |
|---|---|
| Imagens publicadas ou build a partir de um clone (A/B) | `http://localhost` |
| Desenvolvimento local (C) | `http://localhost:3000` |
| Uma instância remota | `confer.example.com` |

Um endereço sem esquema é tratado como `https://`, exceto `localhost` e `127.0.0.1`, que são
lidos como `http://`: ninguém põe certificado na máquina em que está sentado. O endereço fica guardado apenas naquele dispositivo, e trocar de instância
limpa junto a sessão conectada — um token pertence ao gateway que o emitiu, e levá-lo para
outro só pode render um 401.

Do lado do gateway, exatamente duas origens são permitidas em `/api/v1/*`: `tauri://localhost`
e `http://tauri.localhost`. Só um aplicativo Tauri na máquina do próprio usuário pode ocupá-las
— nenhuma página web consegue reivindicá-las — e esta API não usa cookies (o token bearer vai
como cabeçalho), então o que se abre aqui é acesso de leitura para código que já tem um token,
não autoridade ambiente.

## Expor a instância a outras pessoas

A pilha padrão escuta em HTTP puro, o que serve bem aos seus próprios usuários e não serve de nada para a federação. **Aqui o HTTPS não é um passo de endurecimento, é a funcionalidade.** A identidade de um agente é um `did:web`, e o algoritmo de resolução é só https: quem receber `did:web:seu.dominio:agents:voce` vai buscar `https://seu.dominio/agents/voce/did.json` e mais nada. Sirva isso por http e a checagem de assinatura de todo peer falha já na resolução, antes mesmo de olhar a assinatura.

### Servir HTTPS

`docker-compose.tls.yml` é uma camada que põe o Caddy na frente da pilha; o Caddy obtém e renova o certificado sozinho. Sobreponha-a a qualquer um dos dois arquivos base:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

ou, pela CLI, `npx confer-cli --domain confer.example.com`.

Três coisas precisam ser verdade, e o Caddy fica tentando até que sejam (acompanhe `docker compose … logs caddy`):

- `PUBLIC_HOST` é o **domínio puro** — sem esquema e sem porta. O Caddy serve a 443 e o mapeamento de portas da camada é fixo, então um `:8443` aqui escutaria onde nada encaminha.
- O registro A/AAAA daquele domínio já aponta para este host.
- As portas **80 e 443** são ambas alcançáveis pela internet. A 80 não é opcional: o Let's Encrypt valida por ela antes que qualquer coisa possa ser servida na 443.

A camada tira a porta publicada do contêiner `client`, então `EXPOSE_PORT` deixa de valer. Os certificados vivem no volume `caddydata` — perdê-lo significa reemitir, e isso tem limite de taxa.

### Todo o resto

- Defina `PUBLIC_HOST` antes de criar contas. Todo DID que esta instância cunha deriva dele, então não é cosmético: deixado em `localhost`, as identidades que você entrega a um peer resolvem para o loopback *dele próprio*. Mudá-lo depois re-hospeda, na próxima subida, as identidades que ainda carregam o antigo padrão `localhost` (uma vez só, e fica no log); qualquer peer que já tenha um DID antigo terá de adicionar o contato de novo.
- Troque todos os segredos padrão (`JWT_SECRET`, `ENCRYPTION_KEY`, e as senhas do banco e do MinIO).
- O cadastro vem aberto por padrão. Um administrador pode fechá-lo a qualquer momento na aba **Admin → Config** (`registration_open`), ou pôr um convite/lista de permitidos na frente.

Trazer o seu próprio proxy reverso (Traefik, um nginx que já exista, um balanceador de carga na nuvem) também funciona: pule a camada, termine o TLS onde quiser, e encaminhe para a porta 80 do contêiner `client`. O `PUBLIC_HOST` ainda precisa bater com o nome que está no certificado.

### Instância pública gratuita na Oracle Cloud (Always Free)

O jeito mais barato de manter uma instância pública de teste sempre ligada é a faixa **Always Free** ARM da Oracle Cloud (4 OCPU / 24 GB / 10 TB de saída, sem limite de tempo). A pilha inteira constrói e roda em `arm64`.

1. Crie uma VM: forma **VM.Standard.A1.Flex** (até 4 OCPU / 24 GB), imagem **Ubuntu 22.04+ (arm64)**. A capacidade ARM é disputada nas regiões populares — escolha uma região grande (Ashburn, Londres) e tente de novo se aparecer «out of capacity».
2. No Console, abra a **security list / NSG** da VCN para permitir entrada em **TCP 80 e 443**. Abra as duas já, mesmo que você comece sem domínio: o script abre o firewall do host para ambas, e esta é a metade que ele não alcança.
3. Entre por SSH e rode o bootstrap (instala o Docker, abre o firewall do host, clona, gera os segredos, constrói e sobe a pilha):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   Com um domínio já apontado para a VM, peça HTTPS na mesma hora:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   Ou clone primeiro e rode `bash infra/oracle-bootstrap.sh`. É idempotente, e rodá-lo de novo com `CONFER_DOMAIN` move uma instância existente para aquele domínio.
4. Abra a URL que ele imprime, cadastre-se, e então dê a si mesmo o papel de administrador: ponha `ADMIN_USERNAMES=<você>` em `~/Confer/.env` e rode de novo `up -d gateway` com os mesmos arquivos `-f`.

Sem `CONFER_DOMAIN` isso serve HTTP puro por IP — ótimo para testar, mas a instância não consegue federar, porque `did:web` só resolve sobre HTTPS.

## Atualizar uma instância criada antes de 2026-08-29

O Confer agora roda **PostgreSQL 18** e **Qdrant 1.19**; antes rodava 16 e 1.12. Nenhum dos dois lê o armazenamento que o anterior escreveu, então uma instância que já tenha dados precisa de uma migração antes de subir. Nada se perde, e as duas falhas são barulhentas: o postgres se recusa a subir e diz por quê, e o qdrant entra em pânico ao carregar. Uma instalação nova não precisa de nada disso.

O `npx confer-cli` verifica o caso do postgres antes de subir qualquer coisa e imprime estas mesmas instruções. Para ficar nas versões antigas por enquanto, rode a CLI que as trazia: `npx confer-cli@0.3.3`.

Substitua abaixo pelo seu próprio arquivo de compose e nome de projeto — `docker-compose.prod.yml` para um clone, ou `-p confer -f ~/.confer/docker-compose.ghcr.yml` para o caminho da CLI. Os volumes se chamam `<projeto>_pgdata` e `<projeto>_qdrantdata`.

**1. Faça backup, duas vezes.** Um dump lógico e uma cópia byte a byte de cada volume falham de jeitos diferentes, e é justamente por isso que se tira os dois.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. Exporte os vetores** — com os vetores, para que nada precise ser embutido de novo. Salve a saída em `qdrant-export.json`:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333", out = {};
for (const { name } of (await (await fetch(base + "/collections")).json()).result.collections) {
  const info = (await (await fetch(base + "/collections/" + name)).json()).result;
  const points = []; let offset = null;
  do {
    const body = { limit: 256, with_payload: true, with_vector: true, ...(offset ? { offset } : {}) };
    const page = (await (await fetch(base + "/collections/" + name + "/points/scroll",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).result;
    points.push(...page.points); offset = page.next_page_offset;
  } while (offset);
  out[name] = { config: info.config.params, points };
}
console.log(JSON.stringify(out));' > qdrant-export.json
```

**3. Troque os volumes e suba as versões novas.** Remover os volumes é o passo destrutivo; não o rode até os passos 1 e 2 terem produzido arquivos que você olhou.

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. Restaure.** O dump recria o papel e o banco `confer` que o contêiner novinho já criou, então dois erros de `already exists` são esperados; qualquer outro, não.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

Depois devolva os vetores ao lugar — as coleções primeiro, já que o aplicativo só as cria preguiçosamente:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333";
const data = JSON.parse(await new Response(Bun.stdin.stream()).text());
for (const [name, { config, points }] of Object.entries(data)) {
  await fetch(base + "/collections/" + name,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
  if (points.length === 0) continue;
  await fetch(base + "/collections/" + name + "/points?wait=true",
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ points }) });
}' < qdrant-export.json
```

**5. Verifique contra os dados, não contra os logs.** As contagens de linhas devem bater com as da instância antiga, e uma busca deve devolver resultados:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

Guarde `confer_pgdata_backup` e `confer_qdrantdata_backup` até ter usado a instância por um tempo — são o único caminho de volta.

## Resolução de problemas

| Sintoma | Causa provável / solução |
|---------|--------------------|
| `postgres` reinicia em laço depois de uma atualização | O volume dele foi escrito pelo PostgreSQL 16. Veja [Atualizar uma instância criada antes de 2026-08-29](#atualizar-uma-instância-criada-antes-de-2026-08-29). |
| `qdrant` sai com 101 e um rastro de pânico | O armazenamento dele foi escrito pelo Qdrant 1.12. A mesma seção acima. |
| `port is already allocated` na 80 | Outra coisa é dona da porta 80. Ponha `EXPOSE_PORT=8080` no `.env` e abra http://localhost:8080. |
| A interface web carrega mas toda requisição dá 500 | Veja `docker compose -f docker-compose.prod.yml logs gateway`. Na maioria das vezes `JWT_SECRET` ou `ENCRYPTION_KEY` está vazia: elas não têm padrão no compose, então precisam estar presentes no `.env`. |
| `migrate` sai com código diferente de zero | O Postgres ainda não estava saudável, ou a `DATABASE_URL` está errada. Rode de novo `docker compose -f docker-compose.prod.yml up -d`; `migrate` é idempotente. |
| Plugin: `login failed` / 401 | `CONFER_GATEWAY_URL` errada (veja a tabela — em produção é a porta 80, não a 3000), ou usuário/senha errados. |
| Plugin: `connection refused` na :3000 | Você está na instalação de um comando; use `http://localhost` em vez de `:3000`. |
| As chamadas ao LLM falham | Nenhuma chave de LLM configurada para o seu usuário. Adicione uma nas Configurações. |
| Erros de embedding ou de RAG | Veja `.claude/skills/rag-debug` ou rode a skill rag-debug para diagnosticar Qdrant, embedding e MinIO. |

## Veja também

- [`docs/02-architecture.md`](./02-architecture.md) — arquitetura do sistema e fronteiras entre serviços
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — configuração para desenvolver, pilha de testes, convenções
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — referência do plugin do Claude Code

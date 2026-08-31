# Confer — Conception du plugin MCP pour Claude Code

Faire de Confer un serveur MCP de Claude Code, pour que Claude Code puisse consulter directement des Agents fournisseurs ou internes pendant qu'il écrit du code, et déposer les réponses dans le projet. **C'est la fonctionnalité décisive de Confer.**

## Principes de conception

Il ne s'agit pas d'« accrocher un outil », mais de donner à Claude Code une **équipe d'experts métier**. À chaque fournisseur correspond un « expert » doté d'une mémoire durable, et le savoir se dépose dans le projet sans se perdre d'une session à l'autre.

Cinq piliers de conception (le détail stratégique est dans `docs/01-product.md`) :

1. Vendor specialist subagent — un expert métier persistant
2. Dépôt de savoir au niveau du projet — `.claude/peers/`
3. Pre-flight design review — passer par l'expert avant d'écrire du code
4. Post-flight code review — faire relire le code écrit par l'expert
5. Priorité d'autorité + transparence d'identité — dans son propre domaine, le jugement du fournisseur l'emporte sur celui du LLM généraliste

## Installation

> Le `claude mcp add … @confer/mcp-server` avec OAuth ci-dessous est **la vision cible**. L'installation réelle de la v0.1 se trouve à la fin de cette section, sous « Implémentation actuelle (v0.1) » : ce qui existe aujourd'hui, c'est le plugin `confer-a2a` avec authentification par variables d'environnement.

```bash
# du point de vue de l'utilisateur (vision)
claude mcp add confer npx -y @confer/mcp-server

# au premier démarrage, guide l'OAuth qui relie le compte Confer
claude mcp config confer
# choisir l'instance : cloud.confer.ai ou l'URL de la vôtre
# l'OAuth bascule vers le navigateur pour l'authentification
```

Fichier de configuration (édité par l'utilisateur) :

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # consulter automatiquement à la détection de mots-clés
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "fr"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### Implémentation actuelle (v0.1)

L'OAuth et le paquet npx de la vision n'existent pas encore. Ce qui est fait, c'est l'**installation en un clic depuis le marketplace de plugins**, avec authentification par variables d'environnement (la clé privée de signature reste toujours dans la passerelle et n'en descend jamais) :

```bash
# 1. ajouter le marketplace et installer le plugin (ce dépôt est le marketplace)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. exporter le compte dans le shell (le plugin le lit depuis l'environnement ; les identifiants ne sont pas écrits dans le dépôt)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# facultatif : export CONFER_GATEWAY_URL=http://localhost:3000  (valeur par défaut)
```

Le plugin embarque un bundle autonome (`plugins/confer-a2a/dist/server.mjs`, qui tourne sous `node` nu, sans monorepo ni `bun`), généré depuis `packages/mcp-a2a` par `bun run --filter @confer/mcp-a2a build:plugin`. Il fournit 15 outils (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply`, entre autres) ; les détails sont dans `plugins/confer-a2a/README.md` et `packages/mcp-a2a/README.md`.

Qui développe dans le dépôt peut se passer du plugin et utiliser directement le `.mcp.json` de la racine (qui pointe vers le `server.ts` des sources) ou `claude mcp add`.

## Outils MCP exposés

### `ask_peer`

Poser une question à un Agent pair.

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

Retourne :

```json
{
  "answer": "Avec 0x03, Read Holding Registers…",
  "citations": [{"source": "Manuel de communication du X100 v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

Lister les Agents pairs actuellement disponibles.

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

Découvrir un nouvel Agent pair (recherche par domaine).

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

Lire le savoir déposé dans ce projet.

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

Écrire du savoir de projet (appelé automatiquement après ask_peer, ou manuellement).

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

Pre-flight : soumettre le plan de conception à l'expert.

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

Post-flight : faire relire par l'expert le code déjà écrit.

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

## Ressources MCP exposées

Claude Code peut les référencer avec la syntaxe `@resource:…`.

### `confer://peers/{peer_slug}/facts`

Retourne le fichier de facts au format markdown.

### `confer://peers/{peer_slug}/conversations/{thread_id}`

Retourne l'enregistrement complet d'une conversation.

### `confer://threads/{thread_id}`

Retourne, comme contexte, une conversation de la messagerie du programme principal (l'utilisateur peut copier l'URL du fil depuis la messagerie et la donner à Claude Code).

## Prompts MCP exposés

Modèles de prompt prêts à l'emploi, que l'utilisateur peut déclencher rapidement.

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

## Comportement autonome

Quand Claude Code appelle le serveur MCP de Confer, celui-ci lui donne des indices pour qu'il se comporte plus intelligemment :

### Signaux déclenchant automatiquement ask_peer

```toml
[auto_consult.triggers]
keywords_match_authority = true        # des mots de peer.authority apparaissent dans le code ou la conversation
explicit_uncertainty     = true        # quand Claude Code dit « I'm not sure »
import_vendor_lib        = true        # le SDK d'un fournisseur a été importé
```

Mise en œuvre : le serveur MCP ajoute l'indice dans la description de l'outil ; par exemple à la fin de celle de `ask_peer` :

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

Claude Code voit cet indice et décide seul d'appeler.

### Écriture automatique de la mémoire de projet

Après chaque `ask_peer` réussi, le serveur MCP tente d'extraire de façon structurée les « faits » de la réponse et de les écrire dans `facts.md` :

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## Identité de bout en bout

La requête A2A porte l'étiquette `via: claude-code` :

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

L'Agent d'en face peut adapter le style de sa réponse selon `context.via` :

- `via: claude-code` → réponse structurée (blocs de code, JSON, noms de champs clairs)
- `via: web` → réponse en langage naturel, avec plus d'explication et de contexte
- `via: mobile` → concis, l'essentiel mis en avant, lisible sur petit écran

Cet indice n'a rien d'obligatoire et l'Agent d'en face peut l'ignorer. Mais il vaut mieux que tout le monde le respecte.

## Sécurité et confiance

### Couche de permissions

Quand Claude Code appelle `ask_peer` via MCP, c'est L1 par défaut (consultation en lecture seule). En revanche :

- `request_code_review` (partager du code avec le pair) → L2, on demande à l'utilisateur la première fois
- `share_files` (partager un répertoire de fichiers) → L2
- `commit_on_behalf` (décider à la place de l'utilisateur) → L3, on demande à chaque fois

La demande de permission est relayée par le serveur MCP au programme principal, qui affiche une carte de permission dans l'interface de messagerie ; l'utilisateur tranche et le résultat revient à Claude Code, qui poursuit son travail.

### Couche de confiance

- avec `peer.{slug}.trust = "high"`, la réponse de ce pair dans son périmètre d'autorité l'emporte sur les connaissances générales de Claude Code
- avec `trust = "medium"`, la citation sert de référence mais Claude Code la signale comme telle
- avec `trust = "low"`, ou pour un pair nouvellement ajouté et non vérifié, on demande toujours à l'utilisateur de confirmer le résultat cité

### Débit et coût

Limitation de débit locale au serveur MCP :

- au plus 50 `ask_peer` vers un même pair au sein d'une session Claude Code
- au-delà du cumul, une invite « on continue ? » s'affiche
- le coût estimé de chaque appel est affiché (d'après le modèle qu'utilise l'Agent d'en face)

## Commandes CLI

Commandes d'appoint, à utiliser depuis le shell :

```bash
# lister les pairs enregistrés
confer peer list

# ajouter un pair
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # interroge automatiquement le well-known

# consulter la mémoire du projet
confer memory show abc-industries
confer memory show abc-industries --section facts

# poser une question directement en ligne de commande
confer ask abc-industries "Quelle est la plage de tension du X100 en mode RTU ?"

# synchroniser la mémoire du projet avec le serveur Confer
confer sync push
confer sync pull
```

## Points d'implémentation du serveur MCP

Pile technique :

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- cache local SQLite (pour ne pas solliciter le serveur à chaque fois)
- le jeton est rangé dans Keychain / Credential Manager

Fichiers principaux :

```
packages/mcp-server/
├── src/
│   ├── index.ts              # point d'entrée du serveur MCP
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # client de l'API Confer
│   ├── auth.ts               # flux OAuth
│   ├── cache.ts              # cache local SQLite
│   └── config.ts             # lit .claude/confer.toml
└── package.json
```

Exemple de point d'entrée :

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

## Critères de recette (v1)

- [ ] `claude mcp add confer` installe en une ligne
- [ ] le premier démarrage guide la configuration OAuth de bout en bout
- [ ] `ask_peer` tient en moins de 10 s de bout en bout (temps de réflexion du LLM compris)
- [ ] `read_project_memory` en moins de 100 ms (avec succès du cache local)
- [ ] la revue pre-flight amène Claude Code à corriger son plan
- [ ] la mémoire de projet suit le dépôt après un commit git
- [ ] au moins un Agent fournisseur public disponible (pour la démo : mock-vendor.confer.dev)

## État de l'implémentation (v0.1)

Tout ce qui précède est la vision complète. La première version concrète, `packages/mcp-a2a`, boucle déjà le cycle central : « consulter un agent pair ».

**Architecture (deux couches)**

- La passerelle gagne la consultation A2A sortante à l'initiative de l'utilisateur (`/api/v1/consult/*`, voir `docs/05-api.md`). Jusque-là, la plateforme n'avait qu'un seul chemin d'envoi A2A — « entrant → réponse automatique » — et aucune route sortante déclenchée par l'utilisateur.
- `packages/mcp-a2a` : un serveur MCP en stdio qui se connecte à la passerelle sous l'identité d'**un utilisateur Confer configuré** pour obtenir un jeton, et expose la capacité de consultation sous forme d'outils. La signature reste dans la passerelle ; la clé privée n'en sort pas.

**Outils implémentés (15)**

| Domaine | Outils |
|----|------|
| Découverte | `list_agents` / `get_agent_capabilities` / `find_agents` |
| Consultation | `ask_agent` (attente synchrone) / `follow_up` / `get_conversation` |
| Avancé | `ask_multiple` (en parallèle, 5 au maximum) / `check_reply` (récupération asynchrone) |
| Exploitation | `whoami` |
| Personne précise | `ask_person_agent` (interroger l'agent d'une personne donnée ; l'assistant préremplit) |
| Mémoire de projet | `read_project_memory` (lit facts/decisions ; leur absence donne du vide, pas une erreur) / `write_project_memory` (écrit facts ou decisions sans que l'un efface l'autre, en incrémentant `version`) |
| Découverte + revue | `discover_peer` (découvre un pair par domain/did/username, l'enregistre et renvoie son `peer_id` ; **n'établit pas la relation de contact** — il faut d'abord l'accepter comme contact dans le programme principal, sinon toute écriture de mémoire ou consultation ultérieure reçoit un `403` : c'est la porte du consentement) / `request_design_review` (demander au pair de relire un plan) / `request_code_review` (demander au pair de relire des fichiers) |

Le paramètre `project` des outils de mémoire est facultatif ; omis, il retombe sur le `projectId` configuré côté MCP (la variable d'environnement `CONFER_PROJECT_ID`, dont la valeur par défaut est le basename du répertoire courant).

**Connexion**

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
        // facultatif : l'id qui délimite la mémoire de projet ; par défaut le nom du répertoire de travail
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**Écart avec la vision (à suivre)** : la liaison OAuth, la mémoire durable du vendor specialist et le dépôt dans `.claude/peers/`, les revues pre/post-flight et la priorité d'autorité restent au backlog. Aujourd'hui l'identité est celle d'un utilisateur unique configuré, les réponses arrivent en long polling, et les permissions en attente sont présentées pour l'instant comme `pending`.

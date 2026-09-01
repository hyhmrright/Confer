# Confer — architecture du système

> **Ce document décrit l'architecture visée, pas l'état de l'implémentation.** Aujourd'hui le gateway tourne en **un seul processus, une seule instance** : la table des connexions WebSocket, les nonces de protection anti-rejeu A2A et les compteurs de limitation de débit vivent tous dans la mémoire du processus (`ws/handler.ts`, `lib/nonce-cache.ts`, `middleware/rate-limit.ts`).
>
> **Le gateway ne peut donc pas tourner en deuxième réplique.** Ajouter des répliques casse silencieusement la protection anti-rejeu A2A : la requête rejouée tombe sur une autre réplique dont la table de nonces est vide, et passe. Les notifications WS manquent les utilisateurs connectés à une autre réplique, et le seuil de limitation se multiplie par le nombre de répliques.
>
> NATS et Redis, cités plus bas, sont la solution prévue pour la mise à l'échelle horizontale ; **ils ne sont aujourd'hui ni déployés ni raccordés** (retirés de `docker-compose*.yml` et de `env.ts` le 2026-08-07 ; jusque-là, des conteneurs qui tournaient à vide et une variable d'environnement que personne ne lisait). Pour passer réellement à l'échelle horizontale, il faut d'abord déplacer ces trois états en mémoire vers un stockage partagé — les nonces d'abord, ils sont critiques pour la sécurité.

## Vue d'ensemble

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

## Principes de conception

- **Bordure sans état, cœur avec état** (visé, non implémenté) : un gateway sans état et extensible horizontalement est la forme visée ; **aujourd'hui le gateway porte un état en mémoire et ne tolère qu'une instance**, voir la note en tête de document.
- **Prêt pour la fédération dès le premier jour** : identité DID:web + AgentFacts, et même une instance unique parle le protocole de fédération, si bien que fédérer plus tard ne coûte aucune migration.
- **Apportez votre propre clé de LLM** : la plateforme ne porte pas le coût du LLM ; chacun utilise sa propre clé d'API.
- **Le protocole d'abord** : les interactions centrales passent par des protocoles ouverts (A2A, MCP, DID:web, NANDA AgentFacts), sans nous enfermer dans un protocole maison.
- **Bun + TypeScript de bout en bout** : backend en Bun + Hono, client en Tauri + React, types partagés.

## Frontières entre services

### 1. Edge API Gateway

Voir `docs/05-api.md`.

- **Rôle** : terminaison TLS, double authentification (utilisateur et A2A), limitation de débit sur quatre dimensions, routage HTTP/WS/SSE, diffusion multi-appareils.
- **Technologie** : Bun + Hono.
- **Dépendances clés** : JWKS (validation du jeton utilisateur), cache des documents DID, NATS (diffusion).
- **Ce qu'il ne fait pas** : logique métier, persistance des données métier, appels au LLM.

### 2. Agent Runtime

À chaque utilisateur correspond une instance d'Agent résidente.

- **Rôle** :
  - Tenir l'état de l'Agent de l'utilisateur (choix du modèle, outils, politique, mémoire).
  - La boucle d'appels au LLM (abstraction multi-fournisseurs).
  - Le client MCP, connecté aux serveurs d'outils que l'utilisateur a installés.
  - Les appels A2A sortants (aller discuter avec l'Agent de quelqu'un d'autre).
  - Le moteur de politiques (décider ce qu'on peut dire à l'autre partie).
- **Cycle de vie** : réveillé à la demande. À l'arrivée d'un message ou d'une requête A2A, il charge son état depuis PostgreSQL, exécute un tour, puis le réécrit.
- **Dépendances clés** : fournisseurs de LLM, serveurs MCP, service d'identité.

### 3. Conversation Hub

- **Rôle** : stockage, abonnement et distribution des messages.
- **Types de conversation pris en charge** :
  - Utilisateur ↔ son propre Agent.
  - Utilisateur ↔ Agent d'un tiers (relayé par son propre Agent).
  - Utilisateur ↔ utilisateur (messagerie ordinaire).
  - Groupes (utilisateurs et Agents mêlés).
- **Dépendances clés** : NATS Streams (persistance + diffusion), PostgreSQL (historique), Redis (présence, compteurs de non-lus).

### 4. Identity & A2A Gateway

- **Rôle** :
  - Gérer les documents DID:web des utilisateurs.
  - Exposer et mettre en cache les AgentFacts.
  - Traiter les requêtes A2A entrantes (vérification de la signature HTTP et du jeton de capacité).
  - Relayer les requêtes A2A sortantes.
  - Limitation de débit et antispam pour les pairs fédérés.
- **Dépendances clés** : PostgreSQL (cache des DID et des pairs), Redis (compteurs de limitation).

La conception détaillée du protocole se trouve dans `docs/03-protocol.md`.

### 5. MCP / Tools Connector

- **Rôle** :
  - Gestion des connexions aux serveurs d'outils MCP installés par l'utilisateur.
  - C'est par ici que l'Agent Runtime appelle les outils.
  - Encapsulation normalisée des résultats d'appels d'outils.
- **Dépendances clés** : `@modelcontextprotocol/sdk`.

## Couche de données

| Composant | Usage | État |
|---|---|---|
| PostgreSQL | Utilisateurs, Agents, conversations, messages, permissions, relations avec les pairs (stockage principal) | ✅ en service |
| Qdrant | RAG de la mémoire longue de l'Agent, index des bases de connaissances de l'utilisateur | ✅ en service |
| Compatible S3 (MinIO) | Stockage des fichiers des bases de connaissances | ✅ en service |
| Redis | Session, présence, compteurs de limitation, cache des données chaudes | ⬜ non déployé, utile seulement à la mise à l'échelle horizontale |
| NATS Streams | Diffusion des messages (user.{uid}.events) + file de tâches de l'Agent Runtime | ⬜ non déployé, utile seulement à la mise à l'échelle horizontale |

## Architecture du client

- **Socle** : Tauri 2.0 (noyau Rust + rendu WebView).
- **Frontend** : React 19 + TypeScript + Tailwind CSS.
- **État** : Zustand ou Jotai (légers).
- **Routage** : TanStack Router.
- **Réseau** : fetch natif + WebSocket natif + EventSource (SSE).
- **Stockage local** : SQLite et le magasin clé-valeur fournis par Tauri (cache des conversations, brouillons hors ligne).

### Couverture multiplateforme

| Plateforme | Par |
|---|---|
| iOS | Prise en charge iOS de Tauri 2.0 |
| Android | Prise en charge Android de Tauri 2.0 |
| Windows | Tauri 2.0 |
| macOS | Tauri 2.0 |
| Linux | Tauri 2.0 |

Une seule base de code, aucune solution de repli native.

### Plugin Claude Code

Voir `docs/06-claude-code-plugin.md`.

- Un processus serveur MCP distinct, écrit en Node.js ou Bun.
- Installé par l'utilisateur avec `claude mcp add confer <command>`.
- Lié au compte Confer de l'utilisateur par OAuth ou par jeton.

## Architecture de déploiement

### Instance unique (particuliers / petites équipes)

Le `docker-compose.prod.yml` réel (agent-runtime et identity sont des bibliothèques internes au gateway, pas des services) :

```
  - gateway   (service Bun, réplique unique — voir la note en tête)
  - client    (frontend servi par nginx)
  - migrate   (tâche unique)
  - postgres
  - qdrant
  - minio
```

Déploiement : `docker compose -f docker-compose.prod.yml up -d` et c'est utilisable.

### Instance d'entreprise

- Le même Docker Compose lancé comme déploiement indépendant.
- Avec son propre domaine (`acme.com`).
- Exposant `https://acme.com/.well-known/did.json` et `https://acme.com/.well-known/agent.json`.
- Les utilisateurs internes se connectent par SSO.

### Cloud (le cloud de Confer)

> Condition préalable : le gateway est aujourd'hui en réplique unique (état dans le processus). Avant d'en mettre plusieurs, il faut déplacer la table des connexions WS, les nonces A2A et les compteurs de limitation vers un stockage partagé, sans quoi la protection anti-rejeu tombe en silence.

- Kubernetes multi-locataire.
- Chaque utilisateur ou entreprise dans son propre namespace ou schéma.
- Couche d'abstraction des fournisseurs de LLM partagée (mais chacun garde sa propre clé).
- Déploiement multirégion mondial, entrée par la région la plus proche.

## Fédération (entre instances)

N'importe quelle instance de Confer, auto-hébergée ou dans le cloud, peut dialoguer avec d'autres via le protocole A2A.

```
[acme.com]              [vendor-x.com]            [confer.cloud]
 Agent A    <─── A2A ───> Agent B    <─── A2A ───> Agent C
```

Identité et découverte :

- Chaque instance expose son document DID sur `/.well-known/did.json`.
- Chaque Agent expose ses AgentFacts sur `/.well-known/agent.json`.
- Recherche inter-instances : diffusion vers les instances connues + registre public.

## Observabilité

- **Traces** : OpenTelemetry ; le `trace_id` est injecté par le gateway et traverse tous les services.
- **Journaux** : JSON structuré, collecté par Vector / Loki.
- **Métriques** : Prometheus. Les principales :
  - `gateway_active_ws_connections{user_id}`
  - `agent_runtime_llm_tokens_total{provider,role}`
  - `a2a_inbound_requests_total{peer_domain,status}`
  - `mcp_tool_calls_total{tool,result}`

## Frontières de sécurité

- Utilisateur ↔ gateway : JWT vérifié par JWKS.
- Pair A2A ↔ gateway : HTTP Message Signatures (RFC 9421) + clé publique DID:web.
- RPC interne entre services : mTLS ou secret partagé (dans le réseau Docker).
- Appels aux fournisseurs de LLM : clé d'API chiffrée au repos (AES-256, clé dans Vault / KMS).
- Fichiers des utilisateurs : chiffrement côté serveur S3.

## Décisions techniques structurantes

| Décision | Choix | Alternatives | Raison |
|---|---|---|---|
| Langage du backend | Bun + TypeScript | Go | Les SDK MCP et A2A sont TS d'abord ; types partagés sur toute la pile |
| Framework web | Hono | Elysia, Fastify | Léger, rapide, écosystème stable |
| Client | Tauri 2.0 | Flutter, Electron | Une base de code pour cinq plateformes, la sûreté de Rust, des binaires légers |
| Stockage principal | PostgreSQL 18 | MySQL | Bon support de JSON, très extensible, pgvector en option |
| Bus de messages | NATS | Kafka, Redis Pub/Sub | Léger, persistant, abonnement précis |
| Base vectorielle | Qdrant | Pinecone, pgvector | Mature en auto-hébergement, écrit en Rust, performances stables |
| Identité | DID:web | DID:key, OAuth seul | Compatible avec l'infrastructure web existante, recommandé par NANDA |
| Protocole | A2A + MCP + AgentFacts | Un protocole maison | Nous parions sur l'écosystème des protocoles ouverts |

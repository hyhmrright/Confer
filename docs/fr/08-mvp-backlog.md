# Confer — Feuille de route du MVP et reste à faire

Découpé par jalons ; chaque jalon est une version livrable et démontrable.

## v0.1 — Core proof of concept (4-6 semaines)

**Objectif** : qu'une seule machine fasse tourner de bout en bout la chaîne « utilisateur ↔ son propre Agent ↔ Agent d'en face ».

**Périmètre (obligatoire)**

- [ ] backend : gateway + agent runtime + conversation + identity (quatre services, en un seul processus ou séparés, peu importe)
- [ ] schéma PostgreSQL (voir 04-data-model.md), géré par un outil de migrations
- [ ] inscription et connexion des utilisateurs (le mot de passe suffit ; ni OAuth ni passkey)
- [ ] génération et publication du document DID:web (`/.well-known/did.json`)
- [ ] génération et publication du document AgentFacts
- [ ] protocole A2A entrant et sortant (vérification de la signature HTTP + vérification du capability token)
- [ ] agent runtime : la boucle d'appels au LLM (pour l'instant deux fournisseurs seulement, Claude et DeepSeek)
- [ ] moteur de politiques simple : pairs en liste blanche, tout autorisé ou tout refusé
- [ ] client : une seule application Tauri, d'abord les trois bureaux (Linux / macOS / Windows ; le mobile plus tard)
- [ ] que le client sache : se connecter, ajouter des contacts (par DID), converser en tête-à-tête et voir les citations
- [ ] push de messages en temps réel par WebSocket (une instance suffit ; pas de fan-out NATS)
- [ ] sortie du LLM en flux par SSE
- [ ] environnement de développement local en une commande avec Docker Compose

**Out of scope**:

- les groupes, le fan-out multi-appareils, le mobile, l'interface multilingue, le CDN, l'OAuth externe, les politiques complexes
- le plugin Claude Code ne fait pas encore partie de ce lot

**Acceptance**:

Deux personnes lancent chacune leur instance locale de Confer, s'ajoutent mutuellement, conversent et voient les citations.

---

## v0.2 — MVP du plugin Claude Code (3-4 semaines)

**Objectif** : pouvoir consulter un Agent pair depuis Claude Code, et voir la réponse se déposer dans le projet.

**Scope**:

- [ ] implémenter le serveur MCP, avec quatre outils : `ask_peer`, `list_peers`, `read_project_memory` et `write_project_memory`
- [ ] relier le compte Confer à l'instance de Claude Code, façon OAuth
- [ ] analyse du fichier de configuration `.claude/confer.toml`
- [ ] lecture et écriture du répertoire `.claude/peers/{slug}/` (facts.md, decisions.md, conversations/, meta.json)
- [ ] extraction automatique des faits : après ask_peer, tirer de la réponse les faits structurés et les écrire dans facts.md
- [ ] l'outil en ligne de commande `confer` (add peer, list peers, ask, sync)
- [ ] un Agent pair de démonstration (mock-vendor.confer.dev) pour que l'on puisse tester

**Acceptance**:

Quelqu'un installe `claude mcp add confer`, le configure, et peut depuis Claude Code interroger le mock vendor ; la réponse arrive avec ses citations, s'écrit dans `.claude/peers/mock-vendor/facts.md`, est commitée dans git et se recharge d'elle-même à la session suivante.

---

## v0.3 — Groupes et instances d'entreprise (4-5 semaines)

**Objectif** : gérer les conversations de groupe (personnes et Agents mêlés) et pouvoir déployer une « instance d'entreprise » sur une machine.

**Scope**:

- [ ] modèle de données et interface pour les groupes
- [ ] gestion des membres du groupe (ajouter et retirer personnes et Agents)
- [ ] plusieurs Agents mentionnés répondent en même temps (affichage replié, mécanisme d'« adoption »)
- [ ] instance d'entreprise : nom de domaine propre et connexion SSO (OIDC suffit)
- [ ] découverte de contacts : recherche par domaine (taper acme.com trouve les Agents que ce domaine publie)
- [ ] fan-out multi-appareils (arrivée de NATS)
- [ ] mobile (iOS, Android)

**Acceptance**:

Une équipe de cinq personnes et deux Agents mènent une discussion de projet dans un même groupe, avec fluidité. Une entreprise peut monter sa propre instance de Confer, y publier des Agents vers l'extérieur, et se faire trouver par d'autres instances.

---

## v0.4 — Multilingue et réponse en différé (3 semaines)

**Objectif** : rendre le produit utile aux situations internationales et à la communication semi-asynchrone.

**Scope**:

- [ ] i18n de l'interface (chinois et anglais pour commencer, en réservant la place au japonais, à l'allemand et au français)
- [ ] conversation entre Agents de langues différentes (la traduction se fait à l'intérieur de l'Agent destinataire, la citation garde l'original)
- [ ] ajouter le champ `primary_language` à AgentFacts
- [ ] réponse en différé : interface de réglage de la standing policy, boîte d'attente et notifications push
- [ ] ajouter au serveur MCP l'outil de pre-flight design review
- [ ] ajouter au serveur MCP l'outil de post-flight code review

**Acceptance**:

Quelqu'un en Chine interroge en chinois l'Agent d'un fabricant allemand (documentation en allemand) et reçoit la réponse en chinois avec la citation dans l'allemand d'origine. Une fois la standing policy posée, l'Agent traite correctement, en l'absence de son maître, les demandes conformes à la règle, et met les incertaines en attente.

---

## v1.0 — Prêt pour la production (4-6 semaines)

**Objectif** : pouvoir servir en production, avec un support commercial.

**Scope**:

- [ ] observabilité complète (traces OTel, métriques Prometheus, logs Loki)
- [ ] sauvegarde et restauration (sauvegarde physique PG + incrémental vers S3)
- [ ] audit de sécurité (les opérations sensibles laissent un audit log)
- [ ] limitation de débit affinée (les quatre dimensions)
- [ ] tableau de bord de consommation LLM (coût mensuel par Agent)
- [ ] expérience complète du BYO LLM key (stockage chiffré, rotation, quota)
- [ ] site de documentation (manuel d'utilisation, manuel d'auto-hébergement, référence de l'API)
- [ ] mise en service de l'instance publique Confer Cloud (`cloud.confer.ai`)

**Acceptance**:

Au moins 100 utilisateurs inscrits, 10 Agents pairs déployés indépendamment, et une instance qui tourne de façon stable plus de 30 jours.

---

## v1.5+ — Croissance et écosystème (en continu)

**Scope**:

- [ ] annuaire public d'Agents (raccordé au NANDA Index)
- [ ] graphe de confiance et système de réputation
- [ ] version grand public pour les particuliers (interface plus légère)
- [ ] anti-spam fondé sur la réputation
- [ ] webhooks (intégration de systèmes tiers)
- [ ] plusieurs Agents par utilisateur (une personne, plusieurs Agents spécialisés)
- [ ] extension de navigateur (appeler l'Agent depuis une page web)

---

## Granularité des tâches (pour Claude Code)

Chaque jalon se décompose en 50 à 200 petites tâches. Chaque tâche :

1. a des entrées et des sorties nettes
2. a des critères de recette vérifiables
3. ne dépasse pas un jour-personne de travail

Par exemple, quelques tâches de la v0.1 :

### Squelette du backend

- [ ] créer le monorepo (workspaces pnpm ou Bun)
- [ ] `packages/shared` : définitions de types partagées (avec zod ou valibot)
- [ ] `packages/gateway` : squelette de l'application Bun + Hono
- [ ] `packages/agent-runtime` : squelette de la machine à états de l'Agent
- [x] ~~`packages/conversation` : service de stockage et de push des messages~~ — absorbé par le gateway (`ws/handler.ts` + `routes/conversations.ts`) ; le paquet séparé n'avait aucun consommateur, il a été supprimé le 2026-08-07
- [ ] `packages/identity` : DID + AgentFacts + vérification A2A
- [ ] outil de migrations PostgreSQL (drizzle-kit ou prisma)
- [ ] créer les fichiers de migration de toutes les tables

### Couche base de données

- [ ] CRUD User (inscription, connexion, consultation du profil)
- [ ] CRUD Agent (créer son propre Agent, modifier sa configuration)
- [ ] CRUD PeerAgent (ajouter, consulter, supprimer des contacts)
- [ ] CRUD Conversation et gestion des Participant
- [ ] CRUD Message et pagination
- [ ] écriture et lecture de la table Permission

### Identité et protocole

- [ ] génération du document DID (une paire de clés ed25519 par utilisateur)
- [ ] `/.well-known/did.json` endpoint
- [ ] génération d'AgentFacts et son endpoint
- [ ] signeur de signatures HTTP (sortant)
- [ ] vérificateur de signatures HTTP (entrant)
- [ ] émission et vérification des capability tokens
- [ ] téléchargeur de documents DID + cache

### Abstraction du LLM

- [ ] interface de fournisseur LLM (chat, stream, tools)
- [ ] implémentation du fournisseur Claude
- [ ] implémentation du fournisseur DeepSeek
- [ ] stockage chiffré des clés d'API (Vault / env)
- [ ] appliquer la configuration de modèle propre à chaque Agent

### Agent runtime

- [ ] machine à états de l'Agent : boucle load → process → save
- [ ] boucle d'appels au LLM avec tool calling
- [ ] moteur de politiques simple (liste blanche + allow/deny)
- [ ] appel A2A sortant (l'Agent écrit à quelqu'un d'autre)
- [ ] traitement A2A entrant (réception du message de l'Agent d'un autre)

### Gateway et API

- [ ] middleware d'émission et de vérification des JWT
- [ ] tous les endpoints `/api/v1/auth/*`
- [ ] tous les endpoints `/api/v1/conversations/*`
- [ ] handler WebSocket (souscrire, envoyer des messages)
- [ ] handler SSE (sortie du LLM en flux)
- [ ] endpoints A2A entrants + middleware de vérification de signature
- [ ] middleware de limitation de débit (d'abord la version simple : fenêtre fixe)

### Client

- [ ] initialiser le projet Tauri 2.0
- [ ] pages de connexion et d'inscription
- [ ] écran principal : liste des contacts à gauche, conversation à droite
- [ ] fenêtre d'ajout de contact (par DID ou par domaine)
- [ ] liste des messages de la conversation (rendu en flux)
- [ ] rendu des capsules de citation
- [ ] rendu de la carte de demande de permission
- [ ] gestion de la connexion WebSocket
- [ ] cache local SQLite des 100 derniers messages

### Contenu de démonstration

- [ ] déployer l'Agent de mock-vendor (pour la démo)
- [ ] manuel simulé du X100 (quelques pages en PDF comme données de RAG)
- [ ] vidéo ou document de démonstration : le parcours complet, de l'ajout d'un contact à l'obtention de la réponse

---

## Risques et décisions précoces nécessaires

| Risque | Atténuation |
|---|---|
| Le SDK MCP évolue encore et son API peut casser | Se caler sur la version stable, surveiller le changelog, faire une couche d'adaptation |
| Le protocole A2A (Google) et le standard NANDA évoluent encore eux aussi | Démarrer sur le sous-ensemble minimal, en gardant la place d'une couche d'adaptation du protocole |
| Tauri 2.0 sur iOS et Android est relativement neuf et peut réserver des surprises | Au stade du MVP, les trois bureaux seulement ; le mobile en v0.3 |
| Le coût du LLM dérape | Quota par défaut + BYO key explicite + tableau de bord de consommation tôt |
| Les SDK des fournisseurs de LLM chinois (DeepSeek/Qwen) ne sont pas stables | Utiliser l'interface compatible OpenAI (tous ces fournisseurs la proposent) comme point d'entrée unique |

## Consignes de mise en œuvre pour Claude Code

1. **Les tests unitaires avant l'intégration** : chaque service doit pouvoir passer ses tests sans dépendre du démarrage des autres
2. **Les migrations de base de données passent par l'outil de migrations**, pas de SQL à la main
3. **Les types se partagent via le paquet `@confer/shared`**, et servent au client comme au serveur
4. **Chaque PR porte sa modification de documentation** (dès lors qu'elle touche au protocole ou à l'API)
5. **Pour implémenter le protocole A2A, préférer une bibliothèque existante** (par exemple le paquet npm `http-message-signatures`) plutôt que réinventer la roue
6. **Pour DID:web, préférer `did-resolver` + `did-jwt`**, qui sont des outils du W3C
7. **Pour le serveur MCP, préférer le SDK officiel** (`@modelcontextprotocol/sdk`)
8. **Écris le sujet du commit comme une phrase qui dit ce que fait le changement**, pas comme un préfixe conventionnel. Attention : `.github/scripts/gen-release-notes.sh` ne reconnaît que les préfixes du genre `feat:` / `fix:`, si bien que les notes de version se rédigent à la main — il ne les tirera pas de sujets en prose

# Confer — conception du protocole

Définit tous les protocoles entre instances de Confer, et entre le client de l'utilisateur et le serveur. Tous reposent sur des standards ouverts, pour faciliter la fédération à venir.

## Identité de l'Agent

### Format DID:web

Chaque instance, personnelle ou d'entreprise, héberge son propre document DID :

```
https://acme.com/.well-known/did.json
```

Structure du document DID (compatible W3C DID v1.0) :

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

Le DID de l'Agent d'un utilisateur prend cette forme : `did:web:acme.com:agents:laowang` — l'instance principale plus un segment de chemin. Une seule instance peut ainsi héberger plusieurs utilisateurs.

Selon la spécification did:web, un **DID à sous-identifiant** (donc avec segments de chemin) se résout vers le document correspondant à ce chemin, et **non** vers le `.well-known` de la racine de l'instance :

- `did:web:acme.com:agents:laowang` → `https://acme.com/agents/laowang/did.json` (deux-points → barre oblique, puis `/did.json`)
- Le DID nu de l'instance, `did:web:acme.com` → `https://acme.com/.well-known/did.json`
- Un vrai port s'encode en `%3A` : `did:web:acme.com%3A3000:agents:laowang` → `https://acme.com:3000/agents/laowang/did.json` (des deux-points nus comme `:8080` forment un segment de chemin, pas un port)

### Rotation des clés

- Le document DID accepte plusieurs méthodes de vérification, ce qui permet une rotation sans rupture.
- L'ancienne clé est conservée au moins 30 jours, pour ne pas faire échouer les requêtes en vol.
- La révocation consiste à retirer la méthode de vérification du document.

## AgentFacts (compatible NANDA)

Chaque Agent publie un AgentFacts qui le décrit. Emplacement :

```
https://acme.com/agents/{slug}/agent.json
```

Ou le répertoire général sous well-known :

```
https://acme.com/.well-known/agents.json
```

Exemple de structure :

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

Les champs :

- `capabilities` : ce que cet Agent sait faire. Claude Code utilise `scope` pour router par mots-clés (en écrivant du code lié au X100, il consulte automatiquement cet Agent).
- `languages` : les langues prises en charge. Sert à la stratégie de traduction.
- `trust.verifiedBy` : caution de confiance d'un tiers (facultatif ; NANDA la fournira plus tard).
- `publicKey` : la clé publique de signature pour la communication A2A.

## Protocole A2A

### La couche protocole

Toute communication A2A passe par HTTPS POST/GET, encodée en JSON. Deux liaisons coexistent sous `/a2a/v1` :

- **La liaison HTTP+JSON d'A2A v1.0 de la Linux Foundation** (`routes/a2a-rest.ts`), avec les chemins exacts du §11.3 de la spécification : `POST /message:send`, `GET /tasks/{id}`, etc. C'est celle qu'annonce l'Agent Card et celle qu'appellent les clients standard. Voir `docs/05-api.md`.
- **Le dialecte propre à Confer** (`routes/a2a.ts`), utilisé entre instances et découvert via `/.well-known/agents.json`.

Les deux partagent exactement les mêmes garde-fous — vérification de signature, garde de consentement, décision de politique, appartenance du fil — tous dans `a2a/inbound.ts` ; seul le format de transport diffère. **Écrire ces garde-fous une fois par liaison est précisément la raison pour laquelle le bug d'injection de fil entre locataires a été écrit quatre fois** ; ne les séparez plus.

**L'essentiel : on utilise HTTP Message Signatures (RFC 9421), pas un jeton bearer.** Pourquoi :

- Un jeton bearer est compromis dès qu'il est intercepté.
- Une signature HTTP est liée à une requête précise (méthode + chemin + requête + empreinte du corps + horodatage).
- Contre le rejeu : l'en-tête `Date` doit tomber dans une fenêtre de 5 minutes, et chaque signature vérifiée est notée dans un cache de rejeu (nonce), si bien que resoumettre la même requête dans la fenêtre est refusé ; vérifier la signature suffit à établir l'identité de l'émetteur.

**Les composants couverts par la signature** sont `@method`, `@authority` et `@path`, plus `@query` lorsque la requête porte une chaîne de requête et `content-digest` lorsqu'elle porte un corps, plus `date`. `@query` n'est pas un raffinement optionnel : `@path` s'arrête au `?`, et le `GET /tasks` de la liaison REST filtre et pagine entièrement par paramètres de requête ; ne pas les couvrir revient à laisser un intermédiaire les réécrire à sa guise, signature toujours valide. Les paramètres de la signature portent en outre un `nonce` aléatoire par requête : `created` n'a qu'une granularité à la seconde, donc deux requêtes identiques dans la même seconde signeraient les mêmes octets et le cache de rejeu du destinataire les prendrait pour une attaque (n'importe quel sondage d'une tâche, ou n'importe quelle reprise, tombe dessus). Un vrai rejeu — les mêmes octets renvoyés tels quels — reste détecté, puisque la signature est alors identique octet pour octet.

**Cette couche n'a pas les `securitySchemes` de la spécification** : ceux-ci sont clé d'API, authentification HTTP, OAuth2, OIDC ou mTLS, et aucun n'est une signature de requête. L'exigence réelle est déclarée sur la Card comme **extension obligatoire**, et la liaison REST l'impose conformément au §3.3.4 : un client qui ne déclare pas cette extension reçoit `ExtensionSupportRequiredError`, plutôt qu'un 401 qui n'explique rien.

### Exemple de requête entrante

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
    "content": "Quelle est la plage de tension du X100 en mode RTU ?",
    "language": "fr",
    "context": {
      "via": "claude-code",
      "project_hint": "modbus integration"
    }
  }
}
```

### Déroulé de la vérification (côté destinataire)

1. Analyser les en-têtes `Signature-Input` et `Signature`.
2. Extraire le DID du paramètre `keyid` de `Signature-Input`.
3. Récupérer le document DID (avec cache : ETag + TTL de 60 s).
4. En tirer la clé publique, reconstruire la chaîne de base de la signature selon RFC 9421 §2.5, et vérifier la signature.
5. Vérifier que `Content-Digest` correspond au hachage du corps.
6. Vérifier que `Date` tient dans les 5 minutes (anti-rejeu).
7. Vérifier le jeton de capacité (style macaroon, détaillé plus bas).
8. **Garde de consentement de la connexion** : l'émetteur figure-t-il déjà dans les contacts du destinataire ? Sinon → le LLM n'est pas exécuté ; la demande est mise en attente comme demande de connexion (voir plus bas).
9. Si oui → passage au moteur de politiques, qui décide de répondre ou non.

### Jeton de capacité

Le jeton de capacité permet à l'Agent émetteur d'annoncer « je viens au nom de l'utilisateur X poser une question de type Y », et de restreindre les droits finement.

De style JWT, mais dans l'esprit des macaroons :

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

- `scope` : quels types de questions il peut poser.
- `delegation_depth` : combien de fois la requête a été relayée par délégation (pour éviter une chaîne infinie).

### Réponse en flux

Le LLM produit sa réponse en flux, et A2A prend aussi en charge le SSE :

```http
GET /a2a/v1/stream/{message_id} HTTP/1.1
Host: acme.com
Signature: ...
```

Renvoie un `text/event-stream` :

```
event: token
data: {"text": "Le X100 "}

event: token
data: {"text": "en mode RTU "}

event: citation
data: {"source": "Manuel d'installation du X100 p.12", "url": "..."}

event: done
data: {"thread_id": "thread_8f3a9c"}
```

## Modèle de permissions (inspiré de Claude Code)

Trois niveaux :

### L1 — automatique (sans confirmation)

- Mon Agent lit mes propres données.
- L'Agent d'en face répond en citant ses propres documents.
- Conversation purement consultative entre Agents (sans effet de bord ni partage de données).

### L2 — demander une fois

- Partager un répertoire ou un fichier avec l'Agent d'en face.
- Laisser l'Agent d'en face voir le contexte de ma conversation.
- Relayer des données vers une autre instance.
- Activer un outil (la première fois).

Dans l'interface : une carte de permission s'ouvre, avec quatre choix :
- Autoriser cette fois
- Toujours autoriser (restreint à ce pair et à cette portée)
- Voir les détails
- Refuser

### L3 — consentement explicite (demandé à chaque fois)

- Que mon Agent accepte une invitation, paie ou signe un contrat en mon nom.
- Les opérations irréversibles (supprimer, virer de l'argent, s'engager auprès d'un tiers).
- Les engagements à portée financière ou juridique.

Dans l'interface : fenêtre modale + liste détaillée de l'opération + compte à rebours (contre les clics accidentels).

### Politiques permanentes

L'utilisateur peut fixer d'avance des règles qui l'emportent sur le comportement par défaut :

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

### Garde de consentement de la connexion

Répondre à un message A2A consomme le budget LLM **du destinataire**. Pour qu'un Agent inconnu ne puisse pas envoyer des messages à volonté et brûler les jetons de son propriétaire à son insu, être connecté est la condition préalable à cette dépense :

- **Pair déjà connecté** (présent dans les `peer_contacts` du destinataire) → la connexion vaut consentement ; on passe au moteur de politiques et le traitement suit son cours.
- **Pair non connecté** → `POST /a2a/v1/messages` renvoie `202` avec le corps `{ "status": "pending_connection" }` ; **aucune conversation n'est créée, aucun message n'est enregistré, aucun LLM n'est exécuté**. En parallèle, une demande de connexion `action='connect'` est déposée dans la boîte des demandes en attente (dédupliquée par pair, pour que des messages répétés ne l'inondent pas).
- Le propriétaire voit dans sa boîte de permissions « tel Agent demande à se connecter + son premier message ». S'il **approuve**, l'entrée est écrite dans `peer_contacts` (la connexion est faite) et les messages de ce pair sont ensuite traités normalement ; s'il **refuse**, aucune connexion n'est établie.

Le modèle ressemble à LinkedIn ou à une fédération d'entreprises : **couche de découverte ouverte** (n'importe qui peut lire `agents.json` et les AgentFacts), **couche d'interaction soumise au consentement** (on ne consomme le calcul d'autrui qu'une fois connecté).

Deux chemins mènent à l'état « connecté » :
1. Le destinataire ajoute le pair de lui-même, via `POST /contacts/lookup` → `POST /contacts`.
2. Le pair prend l'initiative, et le destinataire approuve sa demande depuis la boîte.

### Rattachement du fil (la portée de `thread_id`)

Le `thread_id` d'un message entrant est une **demande** du pair, pas une instruction faisant autorité. Le gateway ne le réutilise **tel quel** que si deux conditions sont réunies :

1. Ce pair est déjà participant de cette conversation.
2. Cette conversation **appartient au propriétaire de l'Agent destinataire** (`conversations.created_by`).

La seconde ne peut pas être omise : `peer_agents` est unique globalement par DID, si bien qu'un même pair peut être connecté à plusieurs propriétaires. En ne vérifiant que la première, un pair connecté à A et à B pourrait, en écrivant à l'Agent de B, joindre le `thread_id` de A et verser le message dans la conversation de A : l'Agent de B répondrait en prenant l'historique de A pour contexte, la réponse serait écrite dans le fil de A et diffusée à A, et le contenu de la conversation de A finirait déposé dans la mémoire longue de B.

Si les deux conditions tiennent, c'est que l'autre partie répond à un message parti d'ici (le `thread_id` est alors l'identifiant de notre propre conversation). Sinon, il s'agit d'**un fil dans la numérotation du pair** : localement il ne désigne rien, mais il est stable pour le pair, donc notre identifiant de conversation est dérivé de `sha256('a2a-thread:<id du propriétaire>:<id de la ligne du pair>:<thread_id du pair>')` (`lib/derived-id.ts`, qui rend 26 caractères Crockford, de la même forme qu'un ULID). Les messages suivants du même fil du pair retombent ainsi toujours dans la même conversation.

Auparavant, un `thread_id` inconnu était traité comme « pas de fil », et le destinataire **créait une conversation à chaque message reçu** : la relance ne côtoyait jamais la question d'origine, la liste de conversations du propriétaire se remplissait de fils d'une seule ligne, `loadA2AHistory` ne trouvait aucun historique, et l'Agent répondait à chaque tour comme s'il découvrait le sujet.

Dériver plutôt que « tenir une table de correspondance » a deux avantages : aucune migration nécessaire, et aucune course possible — deux messages simultanés se heurtent sur la clé primaire au lieu de créer chacun une conversation (d'où la création dans une transaction avec `onConflictDoNothing`). Dans la chaîne concaténée, seul le **dernier** segment peut être de longueur variable et sous le contrôle du pair ; les précédents sont des identifiants de 26 caractères, si bien que les deux-points non échappés ne créent aucune ambiguïté.

À la création de la conversation, **le propriétaire et le pair** sont tous deux inscrits dans `conversation_participants`. La ligne de participation du propriétaire est ce qui soutient la liste des conversations et le contrôle d'accès conversation par conversation ; sans elle, le propriétaire ne verrait pas le fil auquel son propre Agent est en train de répondre.

Le `thread_id` est donc **l'identifiant de conversation propre à chaque côté**, et il diffère d'un côté à l'autre. D'où deux règles incontournables :

- **La réponse doit renvoyer le `thread_id` reçu de celui qui a posé la question, pas le sien.** La condition 2 ci-dessus refuserait (à juste titre) un fil qui ne lui appartient pas ; une réponse repartant avec notre identifiant de conversation est donc classée par l'autre extrémité dans une conversation entièrement neuve, tandis que le demandeur continue de sonder celle qu'il a créée — `/api/v1/consult/{id}/reply` reste indéfiniment à `pending`, alors qu'une bonne réponse dort sur les deux machines.
- **`messages.thread_root` reçoit l'identifiant de la conversation locale, jamais la valeur brute du pair.** Cette colonne est un `char(26)` pensé pour nos propres ULID : y ranger une valeur étrangère désignerait une conversation qui n'est peut-être pas la nôtre, et permettrait à n'importe quel pair de faire tomber ce point d'entrée en 500 avec un `thread_id` de plus de 26 caractères. Le `thread_id` entrant est de plus contrôlé en longueur.

### Ne pas pouvoir répondre est aussi une réponse

Quand l'Agent destinataire ne peut pas exécuter le tour (pas de modèle configuré, fournisseur inconnu, fournisseur configuré mais sans clé, ou appel au modèle en erreur), il renvoie un `type: 'notification'` dont le `context.error` porte un code lisible par machine (`no_model_configured` / `unknown_provider` / `no_key_for_provider` / `agent_error`), et dont le `content` est une phrase d'explication en anglais. On prend `notification` parce qu'elle ne déclenche pas une nouvelle réponse automatique à l'autre bout (seule `question` le fait).

Ne pas le faire ne veut pas dire « il manque un avis » : l'échec se réduit à une ligne de journal côté répondant, rien ne part sur le fil, et le `/api/v1/consult/{id}/reply` du demandeur sonde jusqu'à l'expiration puis renvoie `pending` — pareil à chaque reprise, **sans aucun moyen de distinguer « il réfléchit encore » de « ça n'arrivera jamais »**.

L'autre extrémité est une autre instance et ne partage pas notre langue : le critère est donc le code de `context.error` ; le `content` n'est qu'un texte lisible de secours. Cela ne contredit pas la règle « le serveur ne rédige pas de texte destiné à l'utilisateur » : celle-ci encadre ce qui part vers **le client de cette instance-ci**.

**Ce même échec est aussi enregistré**, sous la forme d'un message `content_type: 'system_notice'` dans la conversation (`in_reply_to` pointe vers la question, `content_json` porte le même code, et le client rédige la phrase via l'i18n). L'envoyer sans l'enregistrer a trois conséquences, toutes survenues pour de bon : le propriétaire voit dans sa messagerie la question d'en face suivie de rien, et n'apprend jamais que c'est lui qui n'avait pas configuré de modèle ; la tâche de la liaison REST A2A reste à `WORKING` au lieu de `FAILED`, et le client sonde quelque chose qui ne s'achèvera jamais ; et `GET /a2a/v1/stream/{id}` renvoie `pending` sans fin. Avec cette note, les trois basculent d'un coup dans un état terminal décidable.

### Adressage : deux DID désignent le même Agent

`to` accepte aussi bien le **DID de l'Agent** (`did:web:<host>:agents:<user>:agent`, celui que liste l'annuaire public `/.well-known/agents.json`) que le **DID du propriétaire** (`did:web:<host>:agents:<user>`). Ce dernier est le seul identifiant qui se résout en un document DID, et c'est celui que le client affiche à l'utilisateur pour qu'il le copie : n'accepter que le premier fait qu'« ajouter un contact en collant son DID » produit un contact joignable, dont la signature se vérifie, et qui répond 404.

De même, pour décider si le pair émetteur est connecté, il faut accepter et le `from` (DID de l'Agent) et le **DID du signataire obtenu à la vérification** (DID du propriétaire) : dans `peer_agents`, la ligne est créée par DID, et lequel des deux s'y trouve dépend de la façon dont le contact a été ajouté à l'époque ; n'accepter que `from` transforme la réponse d'en face en « une demande de connexion d'un inconnu ».

### Boîte en attente (répondre en l'absence du propriétaire)

Quand la question d'un pair **déjà connecté** arrive et que le propriétaire est absent, le moteur de politiques décide (`evaluatePolicy`, action=`ask`, L2) :

- `allow` (le défaut, puisque la connexion vaut déjà consentement) → l'Agent répond directement (`201` + boucle de réponse automatique).
- `ask_user` (le propriétaire a explicitement posé `policies_json.default='ask_user'`, ou une règle `{action:'ask',decision:'ask_user'}`) → **déjà implémenté** : la question entrante est tout de même enregistrée et diffusée (le propriétaire la voit dans sa messagerie), mais **sans réponse automatique** ; une permission en attente `action='ask'` est déposée dans la boîte, et `POST /a2a/v1/messages` renvoie `202 { "status": "pending_approval", "message_id" }`. Le propriétaire voit la question dans `GET /permissions/pending` ; s'il tranche `allow_*` dans `POST /permissions/{id}/decide`, l'Agent répond en son nom (réponse avec `in_reply_to` + remise sortante) ; s'il tranche `deny`, rien n'est répondu. Côté pair, `GET /a2a/v1/stream/{message_id}` renvoie `status:'pending'` avant l'approbation, puis la réponse.
- `deny` (règle de refus explicite) → `403 policy_denied`.

> **Ce que peut faire une réponse A2A** : la réponse A2A entrante et le chat web passent par **la même orchestration partagée** (`runAgentTurn`, dans `orchestration/agent-orchestrator.ts`), mais **leurs capacités diffèrent**. `runAgentTurn` prend un `audience` obligatoire (`'owner' | 'peer'` — obligatoire et non pourvu d'une valeur par défaut, car cette valeur serait justement la permissive), et c'est lui qui détermine à la fois l'outillage et la surface de données atteignable :
>
> - **Tour du propriétaire** (chat web) : `web_search`, `search_knowledge_base` (toutes les bases), `list_knowledge_bases`, `search_memory`, `list_contacts`, avec rappel automatique de la mémoire longue.
> - **Tour d'un pair** (réponse A2A entrante) : seulement `web_search`, `search_knowledge_base` et `list_knowledge_bases`, et la recherche est **limitée** aux bases marquées `shared_with_peers` ; **aucun rappel de mémoire longue**, et ni `search_memory` ni `list_contacts` ne sont proposés — la première contient des faits déposés depuis les conversations privées du propriétaire, la seconde est son graphe social ; répondre à la question d'un inconnu n'a besoin d'aucune des deux.
>
> La frontière tient à la **surface de données**, pas au prompt : la question du pair et les instructions du propriétaire arrivent au modèle comme le même genre de texte, donc « l'Agent refusera de le révéler » ne tient pas ; seul tient le fait que la recherche ne puisse physiquement pas l'atteindre. De même, **ne pas proposer un outil n'est pas un contrôle d'accès** : un modèle peut émettre un appel vers un nom d'outil qu'on ne lui a jamais donné, et c'est pourquoi les branches réservées au propriétaire revérifient l'`audience` dans `executeToolCall`.
>
> Les deux types de tour utilisent la clé **du propriétaire**, pas celle du pair qui interroge. Les extraits de base de connaissances retenus sont persistés comme **citations** dans `messages.citations_json`, et une fois la réponse produite, les faits du tour sont déposés de façon asynchrone dans la mémoire longue (les lignes issues d'un tour de pair sont marquées `a2a`, et leur origine est signalée au rappel). Si le propriétaire n'a pas de clé d'embedding, de base de connaissances ou de Tavily, on redescend proprement à une réponse LLM seule (sans erreur ni citation). La voie de réponse d'`allow` et celle d'un `ask_user` approuvé partagent cette même orchestration.

> Le `scope_json` d'une permission en attente `ask='ask'` a la forme `{ kind:'a2a_question', conversation_id, inbound_message_id, sender_did, peer_id, content }`, ce qui suffit à reconstruire et reprendre la réponse à l'approbation (l'agent et le pair sont relus en direct par `user_id`/`peer_id` ; c'est idempotent : s'il y a déjà une réponse, on saute). L'interface de configuration des politiques permanentes, l'option « modifier puis répondre » et les notifications push restent au backlog.

## Découverte fédérée

### Recherche par domaine

Pour le domaine `acme.com`, le client :

1. Récupère `https://acme.com/.well-known/did.json` pour obtenir le DID principal.
2. Récupère `https://acme.com/.well-known/agents.json` pour lister tous les Agents publics de ce domaine.
3. En choisit un et l'ajoute aux contacts.

### Résolution du DID d'un utilisateur

Une fois obtenu le DID à sous-identifiant de l'Agent d'un utilisateur, son document DID se résout selon la spécification did:web :

- `did:web:acme.com:agents:laowang` → `GET https://acme.com/agents/laowang/did.json`
- Le DID nu de l'instance, `did:web:acme.com` → `GET https://acme.com/.well-known/did.json`

La vérification de signature de l'A2A entrant suit exactement ce chemin : extraire le DID du signataire du `keyid` de `Signature-Input` → le résoudre vers l'URL ci-dessus → prendre dans `verificationMethod` la clé publique correspondant au `keyid` et vérifier. Ce document n'expose que du matériel de clé publique, et `verificationMethod[*].id` est le `key_id` stocké (il n'est pas recomposé à partir du Host de la requête), si bien que l'identifiant obtenu par résolution depuis une autre instance et celui obtenu localement sont toujours le même.

### Registre public (v2 et au-delà)

Se brancher sur le NANDA Index ou un registre public équivalent, avec :

- Recherche par capacité (« trouve-moi un Agent qui connaît Modbus »).
- Recherche par organisation (« l'Agent d'ABC Industries »).
- Recherche par localisation (« les Agents de service près de moi »).

### Graphe de confiance (v2 et au-delà)

- Les Agents de mes contacts remontent en tête.
- Les Agents de l'entreprise de mes collègues remontent en tête.
- Les cautions de tiers (vérifiées par NANDA) portent un badge de confiance.

## Anti-spam

- Limitation de débit par domaine de pair et par minute (compteur Redis).
- Les pairs hors liste blanche sont en basse priorité par défaut.
- L'utilisateur peut bloquer un domaine de pair.
- Score de réputation (v2 et au-delà) : combien d'autres instances l'ont signalé comme spam.

## Stratégie de traduction

- Chaque Agent déclare dans ses AgentFacts un `primary_language` et un `style`.
- Dans une conversation entre langues, la traduction se fait **à l'intérieur de l'Agent destinataire** (c'est lui qui connaît le mieux sa terminologie et ses documents).
- La partie citée **conserve toujours l'original** : l'utilisateur peut consulter la formulation faisant autorité, avant traduction.
- Le comportement par défaut est `preserve-style` (le style est conservé, seule la langue change) ; un usage de consommation peut déclarer `localize-style` (s'adapter aux usages locaux).

## Stratégie d'évolution du protocole

- Tous les protocoles portent un champ `@context` ou `version`.
- Client et serveur restent rétrocompatibles (ils acceptent et ignorent les champs inconnus).
- Les ruptures passent par un incrément de version majeure (par exemple `/a2a/v2/`).
- Compatible avec l'évolution des schémas de NANDA et de l'A2A de Google (nous parions sur l'écosystème ouvert).

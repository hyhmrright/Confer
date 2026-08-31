# Confer — Spécification de l'API

Définit toutes les API entre le client et le serveur, et entre le serveur et les pairs A2A.

## Conventions générales

- Base URL: `https://{instance}/api`
- Encodage : JSON, UTF-8
- Format de date : ISO 8601, UTC (`2024-11-15T14:30:00Z`)
- Identifiants : ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- Format d'erreur :

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## Authentification

- Client utilisateur : `Authorization: Bearer <jwt_access_token>`
- Durée de vie de l'access token : 15 minutes ; celle du refresh token : 90 jours
- Les deux jetons se distinguent par la revendication `typ` (`access` / `refresh`) et **ne sont pas interchangeables** : l'en-tête `Authorization` n'accepte que `access`, et `POST /auth/refresh` que `refresh`. Auparavant seul leur `exp` différait, si bien que le refresh token faisait office de laissez-passer de 90 jours sur tous les points d'accès authentifiés et que les 15 minutes de l'access token ne servaient à rien
- Le refresh tourne à chaque usage et est confronté à `sessions.refresh_token_hash` ; s'il ne correspond pas, c'est un rejeu et toute la session est invalidée. `sessions.expires_at` est la borne **absolue** de la session : la rotation ne la repousse pas
- Les jetons sont conservés dans le stockage local du client, pas dans un cookie HTTP-only (le client est une application de bureau Tauri, où l'équivalent des cookies de même origine n'existe pas)

## API cliente (utilisée par le client utilisateur)

### Authentification

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` requête :

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

Réponse :

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### Configuration de l'utilisateur et de l'Agent

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # si chaque fournisseur est configuré (ne renvoie que des booléens, jamais la clé)
PUT    /api/v1/agents/me/llm-keys      # stocke chiffrées les clés d'API des LLM
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # interroge en direct le fournisseur sur ses modèles disponibles
```

Les valeurs de `provider` proviennent du catalogue de fournisseurs de `@confer/shared` (`packages/shared/src/llm/catalog.ts`), plus le service outil `tavily`. Ce catalogue est lu à la fois par la passerelle, par agent-runtime et par le client : l'URL de base, le chemin de la liste des modèles et le modèle par défaut ne sont écrits qu'à cet endroit, si bien qu'ajouter un fournisseur ne touche que le catalogue.

`/models` relaie la liste de modèles du fournisseur lui-même et ne renvoie jamais une liste tenue localement :

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// une liste vide porte toujours sa raison ; les quatre sont distinctes et appellent chacune un remède différent
{ "models": [], "error": "no_key" }        // ce fournisseur n'a pas encore de clé configurée
{ "models": [], "error": "unauthorized" }  // le fournisseur a refusé la clé (401/403)
{ "models": [], "error": "unreachable" }   // fournisseur injoignable, ou il a renvoyé une autre erreur
{ "models": [], "error": "unsupported" }   // ce fournisseur n'expose pas de point d'accès listant les modèles
```

### Contacts / Agents pairs

```
GET    /api/v1/contacts                     # liste les contacts. Pagination : ?limit=&offset=
POST   /api/v1/contacts                     # ajoute un contact
GET    /api/v1/contacts/{contact_id}        # détail d'un contact (avec son pair)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # modifie partiellement alias / tags / pinned / muted (les champs absents ne sont pas effacés)

POST   /api/v1/contacts/lookup              # recherche par DID / domaine / nom d'utilisateur
```

`POST /api/v1/contacts/lookup` requête :

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` renvoie `{ contacts, total }`. `limit` vaut 50 par défaut, plafonné à 100, et `offset` vaut 0 ; le tri se fait sur `id` (ULID) en ordre décroissant, donc le plus récent d'abord — un tri unique et déterministe est précisément ce qui empêche la fenêtre d'offset de sauter ou de répéter des lignes. `total` est le décompte global et non celui de la page, ce qui permet au client de savoir qu'il est arrivé au bout. Un `limit` ou un `offset` illisible prend la valeur par défaut plutôt que de déclencher une erreur.

Réponse : la liste des Agents candidats trouvés. La recherche **enregistre dans `peer_agents`** les pairs qu'elle découvre et joint à chaque candidat son `id` local (`peer_id`) — et c'est justement cet `id` que `POST /api/v1/contacts` utilise pour ajouter le contact. `POST /contacts` est idempotent : ajouter deux fois le même pair renvoie le contact existant (`200`) plutôt qu'une erreur.

> Ajouter un contact, c'est **le consentement par lequel celui qui reçoit autorise l'autre à consommer son Agent** : seul un pair ajouté comme contact peut déclencher une réponse de mon Agent (et donc dépenser mon budget LLM). Les messages A2A d'un pair non connecté sont mis en attente sous forme de demande de connexion à approuver ; voir « La porte du consentement de connexion » dans `03-protocol.md`.

```
POST   /api/v1/contacts/{contact_id}/policies   # définit les politiques permanentes (remplacement intégral, sémantique de PUT)
```

Le corps de `POST /contacts/{id}/policies` a la forme d'exécution `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` et est écrit tel quel dans `peer_contacts.policy_overrides_json`. **Sémantique de fusion** : lors d'une décision sur une requête A2A entrante, cette surcharge par contact se superpose à la politique de l'Agent — si `contact.default` est présent, il remplace la valeur par défaut de l'Agent, et `contact.rules` passe devant les règles de l'Agent et est donc évalué en premier (une règle précise par contact l'emporte sur une règle générale de l'Agent). Une surcharge vide `{}` est l'identité : la décision est octet pour octet celle qu'on aurait sans surcharge.

### Conversations

```
GET    /api/v1/conversations                       # liste mes conversations (pour l'écran d'accueil)
POST   /api/v1/conversations                       # crée une conversation
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # pagination : ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # envoie un message
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # reçoit la réponse du LLM en flux (SSE)

POST   /api/v1/conversations/{id}/participants     # ajoute un participant
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # marque comme lu
```

`POST /api/v1/conversations/{id}/messages` requête :

```json
{
  "content_type": "text",
  "content": "Quel code de fonction utilise le registre 0x40 du X100 ?",
  "in_reply_to": null,
  "via": "web"
}
```

Réponse :

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### Gestion des permissions

```
GET    /api/v1/permissions/pending               # demandes L2/L3 en attente
POST   /api/v1/permissions/{id}/decide           # approuver ou refuser
GET    /api/v1/permissions/history               # historique
```

`POST /api/v1/permissions/{id}/decide` requête :

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // portée de la décision
}
```

Parmi les demandes en attente, celles dont `action='connect'` sont des **demandes de connexion** (générées par l'entrée A2A lors du premier contact d'un pair inconnu). Les approuver (`allow_*`) inscrit ce pair dans `peer_contacts` et établit la connexion ; les refuser ne l'établit pas.

Celles dont `action='ask'` sont des **questions en attente venant d'un pair déjà connecté** : l'entrée A2A les génère quand la politique de l'Agent tranche `ask_user` pour cette question (voir « Boîte d'attente (réponse en différé) » dans `03-protocol.md`). Les approuver (`allow_*`) fait répondre l'Agent à la question suspendue ; les refuser la laisse sans réponse.

`GET /pending` joint à chaque demande une `description` (la demande de connexion porte son initiateur et son premier message ; la question, son auteur et son texte) pour que le maître puisse trancher.

### Mémoire de projet (liée à l'intégration Claude Code)

```
GET    /api/v1/projects/{project_id}/peers              # les pairs ayant de la mémoire dans ce projet (name/did récupérés par jointure)  ✅ implémenté
POST   /api/v1/projects/{project_id}/peers              # enregistre explicitement un pair dans le projet   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implémenté
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implémenté
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implémenté
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implémenté
```

Précisions de sémantique (v0.1) :

- Toutes les requêtes sont limitées à `user.sub` (isolation entre utilisateurs).
- Avant un PUT, on vérifie que le pair est bien un contact de cet utilisateur (`peer_contacts`) ; sinon on renvoie `403 not_a_contact`.
- Le PUT fait un upsert : la première écriture pose `version=1`, chaque suivante incrémente `version` et rafraîchit `updated_at`. `facts` et `decisions` sont indépendants — écrire une section n'efface pas l'autre.
- `GET facts/decisions` renvoie `200`, une chaîne vide et `version:0` quand ce couple (projet, pair) n'a pas encore de mémoire (et non un 404 : « ce pair n'a encore rien déposé » est un état normal en lecture).
- `project_id` est validé par `^[a-zA-Z0-9._\-/]+$` (1 à 255 caractères) ; sinon on renvoie `400 invalid_project_id`.
- `GET peers` renvoie un tableau vide sur un projet vierge. La relation (projet, pair) se crée implicitement au PUT de facts/decisions (pas d'enregistrement explicite par `POST peers` à ce stade).

### Base de connaissances (RAG)

```
GET    /api/v1/knowledge-bases                                  # liste mes bases de connaissances
POST   /api/v1/knowledge-bases                                  # en crée une
PATCH  /api/v1/knowledge-bases/{kb_id}                          # change le nom ou la description, et l'ouverture aux Agents extérieurs
DELETE /api/v1/knowledge-bases/{kb_id}                          # la supprime avec tous ses documents et vecteurs

GET    /api/v1/knowledge-bases/{kb_id}/documents                # pagination : ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # envoi multipart, champ nommé file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # réindexe
```

Le corps de `POST /knowledge-bases` est `{ name, description? }` (`name` de 1 à 255 caractères) ; la réponse est `201` avec `{ knowledge_base }`.

Le corps de `PATCH /knowledge-bases/{kb_id}` est `{ name?, description?, shared_with_peers? }` ; la réponse est `{ knowledge_base }`. **`shared_with_peers` ne se change qu'ici et n'est pas accepté à la création** : toute base naît « pour moi seul », et l'ouvrir vers l'extérieur est un second geste délibéré.

Ce que `shared_with_peers` décide, c'est **si une question A2A entrante peut fouiller cette base**, et il vaut `false` par défaut. Cela n'affecte pas le propriétaire lorsqu'il discute dans le navigateur : lui cherche toujours partout. Cette frontière doit tomber sur la portée de la recherche et non dans le prompt : la question du pair et les instructions du propriétaire parviennent au modèle comme le même genre de texte, si bien que « l'Agent jugera de ce qu'il peut dire » ne constitue pas une frontière. Pour la même raison, une question A2A entrante **ne rappelle aucune mémoire à long terme** : celle-ci est distillée des conversations du propriétaire lui-même, et pas une seule de ses entrées n'a été marquée comme pouvant quitter cette instance.

`GET /knowledge-bases` renvoie `{ knowledge_bases }` et **n'est pas paginé** : les bases d'un utilisateur sont créées à la main, leur nombre est borné.

`GET /{kb_id}/documents` renvoie `{ documents, total }`. `limit` vaut 50 par défaut, plafonné à 100, et `offset` vaut 0 ; tri sur `id` (ULID) en ordre décroissant, donc le plus récent d'abord — un tri unique et déterministe empêche la fenêtre d'offset de sauter ou de répéter des lignes. `total` est le décompte global, pas celui de la page. Un `limit` ou un `offset` illisible prend la valeur par défaut plutôt que de déclencher une erreur. C'est la seule liste de cette section à croître sans borne, puisque la base de connaissances est justement la cible des envois.

L'envoi passe par `multipart/form-data`, le champ du fichier s'appelle toujours `file`, et chaque fichier est plafonné à **10 Mo** (au-delà : `400 bad_request`). Le `Content-Type` est pris dans le formulaire s'il y figure, sinon déduit de l'extension. La réponse est `201` avec `{ document }`, et `status` vaut déjà `processing` : **le découpage, la vectorisation et l'écriture dans Qdrant se font en asynchrone après la réponse**, le point d'envoi ne les attend pas. Le client interroge donc la liste des documents jusqu'à ce que `status` change.

Valeurs de `status` :

| Valeur | Signification |
|---|---|
| `processing` | Enregistré, en cours de découpage ou de vectorisation. État initial après un envoi comme après un retry |
| `ready` | Consultable. `chunk_count` est le nombre de fragments du document |
| `failed` | L'indexation a échoué (analyse impossible, clé d'embedding manquante ou écriture ratée dans la base vectorielle) |

`POST /{doc_id}/retry` récupère le fichier d'origine dans le stockage objet et le réindexe ; il efface d'abord les vecteurs déjà présents pour ce document, donc aucun fragment n'est dupliqué. Renvoie `400` si le fichier d'origine a disparu (`storage_key` vide) ou si le document est encore en `processing`. La réponse est `{ document }`, avec `status` remis à `processing` et `chunk_count` à zéro.

Supprimer une base de connaissances supprime en cascade toutes ses lignes de document et ses vecteurs dans Qdrant ; supprimer un seul document nettoie en plus ses vecteurs et le fichier d'origine dans le stockage objet. Un échec de nettoyage côté vecteurs ou objets ne bloque pas la suppression en base : mieux vaut un objet orphelin qu'une ligne pointant vers des données déjà effacées.

Tous les points d'accès sont limités à `user.sub` : accéder à la base ou au document d'autrui renvoie `404` (et non `403`, pour ne pas trahir son existence).

> Le proxy inverse doit laisser passer des corps de 10 Mo. `infra/nginx.conf` fixe `client_max_body_size 10m` sur `/api/` ; avec la valeur par défaut de nginx, 1 Mo, les fichiers de 1 à 10 Mo n'atteignent tout simplement pas la passerelle et le navigateur reçoit la page 413 de nginx.

### Pièces jointes

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # téléchargement (302 vers une URL signée)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### Point d'accès

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

L'authentification de la poignée de main est identique à celle de REST, et non un « la signature est bonne, on laisse passer » : `typ` doit valoir `access`, `sid` doit désigner une session qui existe encore, et le compte ne doit pas être `disabled`. Les trois sont indispensables : sans elles, un compte banni n'a qu'à avoir un jeton non expiré pour se reconnecter et continuer à recevoir des messages, tandis que le bannissement lui-même (effacer toutes ses sessions) ne révoque rien sur ce chemin. Bannir **ferme aussi les sockets déjà ouverts** de cet utilisateur : nginx donne à `/ws` un `proxy_read_timeout` d'une journée, et arrêter la prochaine poignée de main n'arrête pas la connexion déjà établie.

### Format des messages

Tous les messages WS sont du JSON et portent un champ `type` :

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### Client → serveur

```
ping                          // battement de cœur
subscribe.conversation        // s'abonner à une conversation (le serveur vérifie la qualité de participant)
unsubscribe.conversation
typing.start                  // n'a d'effet que sur les conversations déjà souscrites
typing.stop
read.ack                      // accusé de lecture
```

La diffusion des `typing.*` suit l'ensemble des abonnements de ce socket. Quand l'abonnement a une porte et pas les événements de frappe, il suffit de connaître l'identifiant d'une conversation pour y injecter un « untel est en train d'écrire » — sous son propre nom d'utilisateur, qui plus est.

### Serveur → client

```
pong
message.new                   // nouveau message
message.updated
message.deleted
typing.update                 // qui est en train d'écrire
presence.update               // un contact se connecte ou se déconnecte
permission.request            // une demande de permission à trancher par l'utilisateur
agent.status                  // ce que fait mon Agent (« consultation de l'Agent d'ABC… »)
conversation.updated
```

`message.new` par exemple :

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
    "content": "Avec 0x03, Read Holding Registers…",
    "citations": [
      {
        "source": "Manuel de communication du X100 v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "fr",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` par exemple :

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

**Il n'y a pas de `description` dans la charge utile, et c'est voulu.** Le serveur ignore dans quelle langue lit le destinataire ; il n'envoie donc que des faits structurés (`action` + l'identité du pair + le `scope` stocké), et la phrase que lit celui qui approuve est composée par le client selon son i18n (`packages/client/src/lib/permission-text.ts`). Ce contrat appartient en propre à `permissionRequestEventSchema`, dans `@confer/shared` : la passerelle s'en sert pour analyser avant l'envoi, le client pour analyser à la réception.

Chaque ligne de `GET /api/v1/permissions/pending` a exactement cette forme (avec un champ `decision` en plus) et sort du même constructeur : la ligne obtenue par sondage et celle poussée par le socket coïncident donc octet pour octet.

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

Types d'événements :

```
event: token
data: {"text":"Avec "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"Manuel de communication du X100 v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## API A2A (vers l'extérieur, appelée par les autres instances de Confer)

Voir `docs/03-protocol.md`. On ne liste ici que les points d'accès.

Deux liaisons coexistent sous le même préfixe et partagent les mêmes portes (`a2a/inbound.ts`) ; seul le format de transport diffère.

**Liaison HTTP+JSON standard d'A2A** (les chemins sont recopiés tels quels de la §11.3 de la spécification ; c'est celle que l'Agent Card annonce) :

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks (pagination par curseur)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # non implémenté → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # non implémenté → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # non implémenté → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**Le dialecte propre à Confer** (entre instances ; découvert via `/.well-known/agents.json`) :

```
POST   /a2a/v1/messages                  # reçoit les messages d'Agents extérieurs
GET    /a2a/v1/stream/{message_id}       # récupère la réponse en flux (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # AgentFacts public
```

Tous les points d'accès A2A exigent la vérification de la signature HTTP du message.

## .well-known endpoints

```
GET    /.well-known/did.json                # document DID principal
GET    /.well-known/agents.json             # liste de tous les Agents publics de cette instance
GET    /.well-known/agent-card.json         # Agent Card standard A2A (seulement si l'instance n'a qu'un Agent public)
GET    /.well-known/openid-configuration    # plus tard : compatibilité OIDC (v2)
```

## Agent Card standard A2A (couche de découverte interopérable)

```
GET    /agents/{username}/agent-card.json   # la Card standard A2A de cet Agent
GET    /.well-known/agent-card.json         # idem, seulement si cette instance n'a qu'un Agent public
```

Conforme à l'`AgentCard` d'**Agent2Agent v1.0** de la Linux Foundation (champs tirés de `specification/a2a.proto` de `a2aproject/A2A` @ v1.0.1, en mapping JSON proto3, d'où le camelCase). Le but est que l'écosystème A2A **découvre** les Agents de cette instance : les noms se ressemblaient mais les protocoles ne se parlaient pas, car le document de découverte d'en face est en `/.well-known/agent-card.json` alors que cette instance n'avait que `/.well-known/agents.json`.

Quelques choix délibérés :

- **Une Card par Agent**, avec `supportedInterfaces[].tenant` = nom d'utilisateur. Le well-known de la spécification suppose un Agent par domaine, alors que cette instance est multi-locataire ; `tenant` est précisément le sélecteur de routage que la spécification définit pour « plusieurs Agents derrière un même point d'accès A2A ». `/.well-known/agent-card.json` ne répond que s'il y a **exactement un Agent public** (le cas de l'auto-hébergement solitaire) ; sinon il renvoie 404 en pointant vers `agents.json` dans le message d'erreur — désigner un compte au hasard comme « l'Agent de ce domaine » serait faux.
- **`streaming: false`**. Des points d'accès en flux existent bel et bien, mais à la forme propre de Confer, pas au `SendStreamingMessage` de la spécification. Annoncer une capacité qu'un client standard ne peut pas utiliser est pire que de ne rien annoncer.
- **Pas de `securitySchemes` déclaré**. Ce que la spécification propose là, c'est clé d'API, authentification HTTP, OAuth2, OIDC ou mTLS, et ce point d'accès n'en accepte aucun : ce qu'il veut, c'est une requête signée. En remplir un au hasard reviendrait à dire au client qu'il peut s'authentifier d'une manière qui sera immanquablement rejetée. L'exigence réelle est déclarée comme **extension obligatoire** (`capabilities.extensions`, avec l'adresse de la RFC 9421 en `uri` et `required: true`), c'est-à-dire le mécanisme que la spécification prévoit exactement pour cela.
- La Card est un **document de découverte** et sa visibilité est identique à celle de `/.well-known/agents.json` : un Agent non public ou désactivé renvoie systématiquement 404, sans quoi cette route deviendrait un moyen d'énumérer des comptes que leur propriétaire n'a pas voulu rendre publics.

- **Une seule liaison est annoncée.** Le dialecte propre à Confer vit sous la même URL, mais n'est pas inscrit dans la Card : la §5.1 exige que toutes les liaisons déclarées par un Agent soient fonctionnellement équivalentes, et le dialecte n'a pas de cycle de vie de tâches. Il se découvre par `/.well-known/agents.json`, et la Card ne promet ainsi rien qu'elle ne puisse tenir.

### Couche message (sémantique de Task)

`POST /a2a/v1/message:send` reçoit le `SendMessageRequest` de la spécification et renvoie un `Task`. **Une tâche est une question entrante** : son `id` est l'identifiant de ce message, son `contextId` la conversation qui l'archive, et son état se déduit de ce qui se produit ensuite — pas de table `tasks` séparée qui doublerait le même fait.

Le modèle asynchrone de Confer, avec sa porte de consentement, tombe exactement sur la machine à états de la spécification :

| Situation | État |
|---|---|
| L'Agent est en train de répondre | `TASK_STATE_WORKING` |
| Terminé | `TASK_STATE_COMPLETED` |
| Ce tour ne peut pas démarrer (aucun modèle configuré, ou le fournisseur a échoué) | `TASK_STATE_FAILED` |
| Suspendu par la politique `ask_user`, en attente du maître | `TASK_STATE_AUTH_REQUIRED` (état d'interruption, non terminal) |
| Le maître a refusé | `TASK_STATE_REJECTED` |

Deux cas n'ont **aucune** tâche à renvoyer, faute de ligne créée : le pair inconnu (mis en attente comme demande de connexion) et le refus direct par politique. Tous deux répondent `403 PERMISSION_DENIED` et se distinguent par `ErrorInfo.metadata.confer_status` — inventer un identifiant de tâche qui donnerait 404 à l'appel suivant serait pire.

Le reste du comportement suit la spécification point par point : le corps d'erreur a la forme d'un `google.rpc.Status` et porte **toujours** `ErrorInfo.reason` (plusieurs erreurs A2A partagent le même code HTTP, et `reason` est le seul champ qui les distingue) ; un client qui n'a pas déclaré l'extension obligatoire reçoit `ExtensionSupportRequiredError` conformément à la §3.3.4, et non un 401 qui n'explique rien ; `historyLength=0` signifie **omettre entièrement le champ**, pas envoyer un tableau vide ; et `nextPageToken` est toujours présent, avec une chaîne vide quand il n'y a pas de page suivante.

Deux écarts délibérés, tous deux notés dans le code : l'attente du `message:send` bloquant **est plafonnée** (55 s, après quoi on renvoie la tâche encore en `WORKING` pour que le client interroge) — la §3.2.2 ne prévoit aucune sortie par délai, et un appel à un LLM n'a pas de borne supérieure ; et l'idempotence par `messageId` (un MAY de la §3.3.1) **n'est pas faite**, car une clé unique sûre entre locataires réclame la portée du propriétaire, que le format de transport du premier message ne fournit pas.

## Webhooks (facultatif, v1.5+)

Permettent à des systèmes extérieurs de s'abonner à des événements :

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

Événements pris en charge : `message.new.peer`, `permission.granted`, `thread.archived`.

## Politique de limitation de débit

| Route | Limite |
|---|---|
| `/api/v1/auth/login` | 10/minute par IP |
| `/api/v1/auth/register` | 3/heure par IP |
| `/api/v1/conversations/*/messages` POST | 60/minute par utilisateur |
| `/a2a/v1/*` | 100/minute par domaine de pair (davantage en liste blanche) |
| WSS | au plus 10 connexions simultanées par utilisateur |

Réponse en cas de dépassement :

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## API de consultation (sortie A2A à l'initiative de l'utilisateur)

Permet à l'utilisateur (ou au serveur MCP qui agit pour lui) d'interroger de sa propre initiative un Agent pair **qui est déjà un contact**, puis d'en recueillir la réponse asynchrone. La signature et la remise se font entièrement dans la passerelle ; la clé privée n'en sort pas.

> Différence avec l'« API de conversations » : `/api/v1/conversations` + `/api/v1/stream`, c'est dialoguer avec **son propre assistant LLM local** ; `/api/v1/consult`, c'est ce qui part par A2A vers **l'Agent de quelqu'un d'autre**.

### POST `/api/v1/consult/:peerId`

Ouvre ou poursuit une conversation de `type='consult'` (une seule par pair, réutilisée), puis signe et remet un `message.type='question'`.

```jsonc
// corps de la requête (consultRequestSchema)
{ "question": "Comment fait-on la rotation des clés ?", "code_context": "…code facultatif…", "language": "fr" }
```

| Réponse | Signification |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | signée et remise |
| `502 { ..., status: "failed", error }` | échec de la remise (pair hors ligne, sans point d'accès, ou problème de signature) |
| `403 not_a_contact` | le pair n'est pas un contact de l'utilisateur courant |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

Attend en long polling la réponse asynchrone du pair (qui arrive par l'entrée `/a2a/v1/messages` avec son `thread_id`, la passerelle la raccrochant au fil correspondant). `wait` est plafonné à 55 s.

- `200 { status: "answered", message }` — la réponse est arrivée
- `200 { status: "pending" }` — délai écoulé sans réponse ; on peut réinterroger plus tard

### GET `/api/v1/consult/:conversationId`

Renvoie l'historique complet de ce fil de consultation (200 messages au maximum).

> Contrat : l'entrée A2A ne déclenche la réponse automatique de l'Agent local que pour `message.type==='question'` ; `answer` et `notification` sont seulement enregistrés et diffusés, afin qu'une réponse de consultation ne provoque pas un échange sans fin.

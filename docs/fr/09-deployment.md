# Confer — déploiement et auto-hébergement

Comment faire tourner soi-même une instance Confer complète — sur son portable pour l'essayer, ou sur un serveur pour la partager. Tout ce qui suit est un chemin réel et éprouvé ; rien n'y est de l'ordre du souhait.

> **Portée :** ce guide couvre l'installation **auto-hébergée en instance unique**, avec ou sans TLS (voir [Servir en HTTPS](#servir-en-https) plus bas). L'hébergement public multi-locataire et le durcissement de la fédération sortent du périmètre de la v0.1 — voir `docs/02-architecture.md` pour la direction architecturale.

## Ce que vous obtenez

Une seule commande démarre toute la plateforme :

| Service | Image / build | Rôle |
|---------|---------------|------|
| `client` | construite depuis `infra/client.Dockerfile` | interface web + proxy inverse nginx (le seul port exposé) |
| `gateway` | construite depuis `infra/gateway.Dockerfile` | API Hono, endpoints A2A, WebSocket — **une seule réplique, voir ci-dessous** |
| `migrate` | à usage unique | exécute les migrations Drizzle puis s'arrête |
| `postgres` | `postgres:18-alpine` | stockage de données principal |
| `qdrant` | `qdrant/qdrant:v1.19.0` | recherche vectorielle pour la base de connaissances RAG |
| `minio` | `minio/minio` | stockage de fichiers compatible S3 |

> **Ne montez pas `gateway` au-delà d'une réplique.** Les connexions WebSocket, les nonces anti-rejeu d'A2A et les compteurs de limitation de débit vivent dans la mémoire de ce processus. Une seconde réplique accepterait des requêtes A2A rejouées (sa table de nonces est vide), manquerait les envois WS pour les utilisateurs connectés à l'autre réplique, et multiplierait les seuils par le nombre de répliques. `docs/02-architecture.md` dit ce qu'il faut déplacer en premier.

nginx (à l'intérieur de `client`) sert la SPA sur le port **80** et fait proxy inverse de `/api`, `/ws`, `/a2a` et `/.well-known` vers le gateway. Le port propre du gateway (3000) n'est **pas** publié en production : tout passe par nginx sur le 80.

## Prérequis

- **Docker** avec Compose v2 (`docker compose`, pas `docker-compose`). Le seul prérequis dur.
- **Node 18+** — uniquement pour `npx confer-cli` (option A). Le chemin Compose pur, également en A, s'en passe.
- Environ 4 Go de RAM libre et 2 Go de disque pour les images et les volumes.
- [Bun](https://bun.sh) ≥ 1.1 — uniquement pour le flux de développement à rechargement à chaud (option C ci-dessous) ou pour régénérer des migrations.

## A. Images publiées (recommandé)

Rien à cloner, rien à construire :

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) refuse de démarrer si Docker ne tourne pas réellement ; il écrit `docker-compose.ghcr.yml` et un `.env` en `0600` dans `~/.confer` — `JWT_SECRET`, `ENCRYPTION_KEY` et les mots de passe de la base et du stockage objet, tous engendrés par `crypto.randomBytes` au premier lancement puis réutilisés —, récupère les images, applique les migrations et interroge `/health` jusqu'à trois minutes. Il annonce le succès quand une page est servie, pas quand les conteneurs démarrent ; si cela n'arrive jamais, il imprime les 40 dernières lignes des logs de `migrate` et de `gateway`. `npx confer-cli down` arrête tout en gardant les données, `npx confer-cli logs` suit le gateway.

Options : `--port` (80 par défaut), `--dir` (`~/.confer` par défaut), `--version` (tag d'image), `--project` (nom du projet compose). Si un projet compose nommé `confer` existe déjà et que cette CLI ne l'a pas créé, elle s'arrête plutôt que de l'adopter : les volumes compose sont indexés par nom de projet, donc démarrer pointerait ces images vers la base de cette autre pile.

La même chose à la main, pour un hôte sans Node :

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

Cela laisse `POSTGRES_PASSWORD` et `MINIO_ROOT_PASSWORD` aux valeurs par défaut du fichier compose (`confer` / `confer-secret`), que la CLI aurait tirées au hasard. Aucun des deux ports n'est publié, donc ce n'est pas un trou sur une machine mono-locataire — mais renseignez les deux dans `.env` sur tout hôte partagé.

`ghcr.io/hyhmrright/confer-gateway` et `-client` sont construites pour linux/amd64 et linux/arm64 à chaque push sur `main`, et étiquetées `latest`, avec le SHA du commit et la version de la release. Épinglez-en une avec `CONFER_VERSION` dans `.env`.

Contrairement à `docker-compose.prod.yml`, ce fichier exécute `migrate` et `gateway` depuis la *même* image. Ce n'est sûr que parce que rien n'est construit ici — voir l'avertissement de l'option B, où les deux peuvent justement diverger.

Ouvrez ensuite **http://localhost**, créez le premier compte, et ajoutez une clé d'API de LLM dans **Réglages** — les trois mêmes étapes que celles listées en B ci-dessous.

Tout ce qui, à partir d'ici, dit `-f docker-compose.prod.yml` vaut pareillement avec `-f docker-compose.ghcr.yml`, exécuté depuis là où ce fichier se trouve (`~/.confer` si la CLI l'y a mis), sauf la mise à jour : il n'y a rien à reconstruire, donc mettre à jour c'est relancer `npx confer-cli`, ou `docker compose -f docker-compose.ghcr.yml pull && … up -d`.

## B. Construire depuis un clone

À utiliser pour faire tourner un arbre modifié, ou pour s'auto-héberger sans dépendre de GHCR :

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

La première construction prend quelques minutes. Une fois terminée :

1. Ouvrez **http://localhost**.
2. Cliquez sur **S'inscrire** (le libellé apparaît dans votre propre langue) et créez le premier compte. (L'inscription est limitée à 3 tentatives par heure et par IP.)
3. Allez dans **Réglages** et ajoutez une clé d'API de LLM (Claude / OpenAI / DeepSeek / Qwen / Ollama). Les clés sont chiffrées au repos avec `ENCRYPTION_KEY` (AES-256-GCM) et ne sont jamais envoyées au client.

### Vérifier que tout va bien

```bash
docker compose -f docker-compose.prod.yml ps        # tous les services "running"/"healthy" ; migrate est "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### Configuration

`.env` pilote la pile de production. Les valeurs par défaut de `.env.example` fonctionnent en local mais sont **non sûres** : changez les secrets avant d'exposer l'instance à qui que ce soit d'autre.

| Variable | Défaut (`.env.example`) | Notes |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **À changer.** Signe les jetons de session des utilisateurs. |
| `ENCRYPTION_KEY` | 64 zéros | **À changer.** Doit faire 32 octets, soit 64 caractères hexadécimaux. Générer : `openssl rand -hex 32`. Chiffre les clés de LLM stockées. |
| `POSTGRES_PASSWORD` | `confer` (défaut de compose) | Mot de passe de la base de données. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | Identifiants du stockage objet. |
| `EXPOSE_PORT` | `80` | Port de l'hôte auquel l'interface web se lie. Mettez p. ex. `8080` si le 80 est pris. |
| `TAVILY_API_KEY` | vide | Repli facultatif pour la recherche web ; une clé par utilisateur dans les Réglages est prioritaire. |
| `ADMIN_USERNAMES` | vide | Noms d'utilisateur séparés par des virgules, promus automatiquement au rôle `admin` au démarrage du gateway. Les comptes doivent déjà être inscrits. Les administrateurs se connectent avec le mot de passe normal de leur compte et obtiennent le panneau d'administration ; ils peuvent ensuite en promouvoir d'autres depuis l'interface. |

> Les clés de LLM, d'embedding et de Tavily ne se mettent **pas** dans `.env` : elles vivent chiffrées par utilisateur en base et se configurent depuis l'interface des Réglages. Les clés de `.env` sont des secrets d'infrastructure, rien d'autre.

Après avoir modifié `.env`, appliquez-le avec :

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Mettre à jour

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate se relance tout seul
```

### Repartir de zéro (efface toutes les données)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v supprime aussi les volumes
```

## C. Développement local (rechargement à chaud)

Ne faites tourner que l'infrastructure dans Docker, et le code applicatif avec Bun :

```bash
bun install
docker compose up -d            # infrastructure seule — Postgres, Qdrant, MinIO (ports publiés sur localhost)
bun run db:migrate
bun run dev                      # gateway sur :3000, client (Vite) sur :1420
```

- Aperçu web : **http://localhost:1420** (Vite fait proxy de `/api` → gateway sur :3000).
- Application de bureau native : `cd packages/client && bunx tauri dev`.

Le `docker-compose.yml` de développement publie chaque port d'infrastructure sur localhost (5432, 6333, 6334, 9000/9001) pour que le gateway lancé localement les atteigne. Voir `CONTRIBUTING.md` pour le flux de développement complet et la pile de tests isolée.

## Connecter le plugin Claude Code

Le plugin `confer-a2a` parle au gateway en HTTP. **Pointez-le vers la bonne URL selon votre installation :**

| Votre installation | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| Images publiées ou un clone (options A/B) | `http://localhost` (nginx sur le port 80 ; le 3000 du gateway n'est pas publié) |
| Développement local (option C) | `http://localhost:3000` (la valeur par défaut) |
| Instance distante | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # faites correspondre au tableau ci-dessus
```

Les Agents pairs que vous consultez doivent déjà être des **contacts** de votre compte (ajouter un contact est la porte du consentement). Référence complète du plugin : [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md).

## Les applications de bureau et mobiles

La version web n'a jamais besoin d'adresse : nginx la sert et relaie `/api` et `/ws` sur la
même origine. Une application de bureau ou Android empaquetée, elle, sert ses propres
ressources depuis `tauri://localhost` (écrit `http://tauri.localhost` sous Windows, Linux et
Android), où un `/api/v1` relatif renvoie au paquet lui-même. Il faut donc lui indiquer à
quelle instance elle appartient, et seule la personne qui l'a déployée le sait.

Au premier lancement, l'écran de connexion comporte un champ supplémentaire, **Adresse de
l'instance**. Renseignez-le comme dans le tableau ci-dessus :

| Votre déploiement | Ce qu'il faut saisir |
|---|---|
| Images publiées ou build depuis un clone (A/B) | `http://localhost` |
| Développement local (C) | `http://localhost:3000` |
| Une instance distante | `confer.example.com` |

Une adresse sans schéma est traitée comme `https://`, sauf `localhost` et `127.0.0.1`, lues
comme `http://` : personne ne pose de certificat sur la machine devant laquelle il est assis. L'adresse n'est stockée que sur cet appareil, et passer à une autre
instance efface aussi la session ouverte — un jeton appartient à la passerelle qui l'a émis,
et le transporter ailleurs ne peut produire qu'un 401.

Côté passerelle, exactement deux origines sont autorisées sur `/api/v1/*` :
`tauri://localhost` et `http://tauri.localhost`. Seule une application Tauri sur la machine de
l'utilisateur peut les occuper — aucune page web ne peut les revendiquer — et cette API
n'utilise pas de cookies (le jeton bearer part en en-tête). Ce qui est ouvert ici est donc un
accès en lecture pour du code qui détient déjà un jeton, pas une autorité ambiante.

## Exposer l'instance à d'autres

La pile par défaut écoute en HTTP simple, ce qui convient à ses propres utilisateurs et ne sert à rien pour la fédération. **Ici, HTTPS n'est pas une étape de durcissement, c'est la fonctionnalité.** L'identité d'un agent est un `did:web`, et l'algorithme de résolution est https uniquement : à qui reçoit `did:web:votre.domaine:agents:vous`, il faut aller chercher `https://votre.domaine/agents/vous/did.json` et rien d'autre. Servez cela en http et la vérification de signature de chaque pair échoue à la résolution, avant même de regarder la signature.

### Servir en HTTPS

`docker-compose.tls.yml` est une surcouche qui place Caddy devant la pile ; Caddy obtient et renouvelle le certificat lui-même. Superposez-la à l'un ou l'autre des fichiers de base :

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

ou, depuis la CLI, `npx confer-cli --domain confer.example.com`.

Trois choses doivent être vraies, et Caddy réessaiera jusqu'à ce qu'elles le soient (regardez `docker compose … logs caddy`) :

- `PUBLIC_HOST` est le **domaine nu** — sans schéma ni port. Caddy sert le 443 et le mappage de ports de la surcouche est fixe, donc un `:8443` ici écouterait là où rien ne renvoie.
- L'enregistrement A/AAAA de ce domaine pointe déjà vers cet hôte.
- Les ports **80 et 443** sont tous deux joignables depuis internet. Le 80 n'est pas facultatif : Let's Encrypt valide par lui avant que quoi que ce soit puisse être servi sur le 443.

La surcouche retire au conteneur `client` son port publié, si bien que `EXPOSE_PORT` ne s'applique plus. Les certificats vivent dans le volume `caddydata` — le perdre signifie les réémettre, ce qui est soumis à quota.

### Tout le reste

- Fixez `PUBLIC_HOST` avant de créer des comptes. Chaque DID que cette instance frappe en dérive, ce n'est donc pas cosmétique : laissé à `localhost`, les identités que vous tendez à un pair résolvent vers *sa propre* boucle locale. Le changer plus tard réhéberge, au démarrage suivant, les identités qui portent encore l'ancien défaut `localhost` (une fois pour toutes, et c'est journalisé) ; tout pair détenant déjà un ancien DID devra rajouter le contact.
- Changez tous les secrets par défaut (`JWT_SECRET`, `ENCRYPTION_KEY`, les mots de passe de la base et de MinIO).
- L'inscription est ouverte par défaut. Un administrateur peut la fermer à tout moment depuis l'onglet **Admin → Config** (`registration_open`), ou la faire précéder d'une invitation ou d'une liste blanche.

Apporter son propre proxy inverse (Traefik, un nginx déjà en place, un répartiteur de charge cloud) fonctionne aussi : sautez la surcouche, terminez le TLS où vous voulez, et renvoyez vers le port 80 du conteneur `client`. `PUBLIC_HOST` doit toujours correspondre au nom porté par le certificat.

### Instance publique gratuite sur Oracle Cloud (Always Free)

La façon la moins chère de faire tourner une instance publique de test en permanence est le palier **Always Free** ARM d'Oracle Cloud (4 OCPU / 24 Go / 10 To de sortie, sans limite de durée). Toute la pile se construit et tourne en `arm64`.

1. Créez une VM : forme **VM.Standard.A1.Flex** (jusqu'à 4 OCPU / 24 Go), image **Ubuntu 22.04+ (arm64)**. La capacité ARM est disputée dans les régions populaires — choisissez une grande région (Ashburn, Londres) et réessayez en cas d'« out of capacity ».
2. Dans la console, ouvrez la **security list / NSG** du VCN pour autoriser l'entrée en **TCP 80 et 443**. Ouvrez les deux dès maintenant même si vous démarrez sans domaine : le script ouvre le pare-feu de l'hôte pour les deux, et c'est cette moitié-là qu'il ne peut pas atteindre.
3. Connectez-vous en SSH et lancez l'amorçage (il installe Docker, ouvre le pare-feu de l'hôte, clone, engendre les secrets, construit et démarre la pile) :

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   Avec un domaine déjà pointé sur la VM, demandez HTTPS dans la foulée :

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   Ou clonez d'abord puis lancez `bash infra/oracle-bootstrap.sh`. Le script est idempotent, et le relancer avec `CONFER_DOMAIN` déplace une instance existante sur ce domaine.
4. Ouvrez l'URL qu'il affiche, inscrivez-vous, puis donnez-vous les droits d'administration : mettez `ADMIN_USERNAMES=<vous>` dans `~/Confer/.env` et relancez `up -d gateway` avec les mêmes fichiers `-f`.

Sans `CONFER_DOMAIN`, cela sert du HTTP simple par IP — parfait pour tester, mais l'instance ne peut pas fédérer, car `did:web` ne se résout qu'en HTTPS.

## Mettre à niveau une instance créée avant le 2026-08-29

Confer tourne désormais sur **PostgreSQL 18** et **Qdrant 1.19** ; auparavant c'était 16 et 1.12. Ni l'un ni l'autre ne lit le stockage écrit par la version précédente, donc une instance contenant déjà des données a besoin d'une migration avant de démarrer. Rien n'est perdu, et les deux échecs sont bruyants : postgres refuse de démarrer en disant pourquoi, et qdrant panique au chargement. Une installation neuve n'a besoin de rien de tout cela.

`npx confer-cli` vérifie le cas de postgres avant de rien démarrer et affiche les mêmes instructions. Pour rester sur les anciennes versions en attendant, lancez la CLI qui les livrait : `npx confer-cli@0.3.3`.

Substituez ci-dessous votre propre fichier compose et votre nom de projet — `docker-compose.prod.yml` pour un clone, ou `-p confer -f ~/.confer/docker-compose.ghcr.yml` pour le chemin CLI. Les volumes s'appellent `<projet>_pgdata` et `<projet>_qdrantdata`.

**1. Sauvegardez, deux fois.** Un dump logique et une copie octet à octet de chaque volume échouent de manières différentes, et c'est bien pour cela qu'on prend les deux.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. Exportez les vecteurs** — avec leurs vecteurs, pour que rien n'ait à être ré-embarqué. Enregistrez la sortie dans `qdrant-export.json` :

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

**3. Remplacez les volumes et démarrez les nouvelles versions.** Supprimer les volumes est l'étape destructrice ; ne la lancez pas avant que les étapes 1 et 2 aient produit des fichiers que vous avez regardés.

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. Restaurez.** Le dump recrée le rôle et la base `confer` que le conteneur tout neuf a déjà créés, donc deux erreurs `already exists` sont attendues ; toute autre ne l'est pas.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

Remettez ensuite les vecteurs en place — les collections d'abord, puisque l'application ne les crée que paresseusement :

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

**5. Vérifiez contre les données, pas contre les logs.** Les comptes de lignes doivent correspondre à ceux de l'ancienne instance, et une recherche doit renvoyer des résultats :

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

Gardez `confer_pgdata_backup` et `confer_qdrantdata_backup` jusqu'à ce que vous ayez utilisé l'instance un moment — c'est le seul chemin de retour.

## Dépannage

| Symptôme | Cause probable / remède |
|---------|--------------------|
| `postgres` redémarre en boucle après une mise à niveau | Son volume a été écrit par PostgreSQL 16. Voir [Mettre à niveau une instance créée avant le 2026-08-29](#mettre-à-niveau-une-instance-créée-avant-le-2026-08-29). |
| `qdrant` sort en 101 avec une trace de panique | Son stockage a été écrit par Qdrant 1.12. Même section que ci-dessus. |
| `port is already allocated` sur le 80 | Quelque chose d'autre possède le port 80. Mettez `EXPOSE_PORT=8080` dans `.env` et ouvrez http://localhost:8080. |
| L'interface web se charge mais chaque requête renvoie 500 | Regardez `docker compose -f docker-compose.prod.yml logs gateway`. Le plus souvent `JWT_SECRET` ou `ENCRYPTION_KEY` est vide : elles n'ont pas de valeur par défaut dans compose, elles doivent donc figurer dans `.env`. |
| `migrate` se termine avec un code non nul | Postgres n'était pas encore sain, ou `DATABASE_URL` est fausse. Relancez `docker compose -f docker-compose.prod.yml up -d` ; `migrate` est idempotent. |
| Plugin : `login failed` / 401 | Mauvaise `CONFER_GATEWAY_URL` (voir le tableau — en production c'est le port 80, pas le 3000), ou mauvais identifiant/mot de passe. |
| Plugin : `connection refused` sur le :3000 | Vous êtes sur l'installation en une commande ; utilisez `http://localhost` au lieu de `:3000`. |
| Les appels au LLM échouent | Aucune clé de LLM n'est configurée pour votre utilisateur. Ajoutez-en une dans les Réglages. |
| Erreurs d'embedding ou de RAG | Voir `.claude/skills/rag-debug`, ou lancez la skill rag-debug pour diagnostiquer Qdrant, l'embedding et MinIO. |

## Voir aussi

- [`docs/02-architecture.md`](./02-architecture.md) — architecture du système et frontières entre services
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — installation pour développer, pile de tests, conventions
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — référence du plugin Claude Code

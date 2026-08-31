# Confer — Mémoire de projet (.claude/peers/)

Définit le format de fichier par lequel le savoir se dépose dans le projet sous l'intégration Claude Code. C'est l'une des innovations centrales de Confer : **faire voyager le savoir du fournisseur avec le projet, sans qu'il se perde d'une session, d'une personne ou d'une machine à l'autre**.

## Arborescence

À la racine de chaque projet :

```
.claude/
├── confer.toml                   # configuration du projet (peers, niveaux de confiance)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # faits vérifiés, structurés
    │   ├── decisions.md          # journal des décisions de conception
    │   ├── conversations/        # historique complet des conversations
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # fragments de code
    │   │   └── read_temp.py
    │   └── meta.json             # métadonnées du pair
    └── internal-sdk/
        ├── facts.md
        └── ...
```

Cela voyage avec git, et tous les collaborateurs le partagent.

## Format des fichiers

### `meta.json`

```json
{
  "peer": {
    "slug": "abc-industries",
    "did":  "did:web:acme.com:agents:support",
    "name": "ABC Industries Support",
    "endpoint": "https://acme.com/a2a/v1",
    "authority": ["X100", "X200", "Modbus", "RTU", "TCP"],
    "languages": ["en", "zh", "de"]
  },
  "trust": "high",
  "registered_at": "2024-11-01T10:00:00Z",
  "last_synced_at": "2024-11-15T14:30:00Z",
  "stats": {
    "total_queries": 47,
    "total_facts": 23,
    "total_decisions": 6
  }
}
```

### `facts.md`

Une liste structurée de faits. **Chaque fait doit porter sa citation** : un « fait » sans citation est une hallucination.

```markdown
# ABC Industries facts (project: modbus-integration)

> Auto-maintained by Confer. Each entry is verified by ABC Industries Agent
> with primary source citation. Do not edit machine-generated entries directly;
> use `confer memory edit` to propose changes.

## Modbus register map (X100)

- `0x40-0x47`: Temperature, 4 channels, units of 0.1°C, int16 signed
- `0x48-0x4F`: Pressure, 4 channels, units of 0.01 MPa, uint16
- `0x50-0x57`: Reserved (do not write)
- Function code: **0x03** (Read Holding Registers) — recommended
- Byte order: big-endian (high byte first)
- Default slave ID: **0x0A (10)** — not 1 as docs imply
  - Source: Manuel de communication du X100 v3.2 p.87
  - Source: Guide d'installation du X100 p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: Manuel d'installation du X100 v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: Manuel de communication du X100 v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

Conventions de format :

- les sujets sont séparés par des titres markdown de niveau deux (`##`)
- chaque fait est un élément de liste
- les valeurs clés ressortent en `**gras**`
- à la fin de chaque groupe de faits, une ligne `Source:` et un horodatage `Verified:` sont obligatoires
- plusieurs sources se notent par plusieurs lignes `Source:`

### `decisions.md`

Les décisions de conception prises dans le projet et liées à ce pair. À la différence des facts (conclusions faisant autorité côté fournisseur), les decisions sont nos choix à nous.

```markdown
# Decisions (project: modbus-integration, peer: abc-industries)

## D1: Use async polling at 200ms

**Date**: 2024-11-15
**Made by**: laowang (with consultation from ABC Agent)
**Status**: Active

We poll the X100 temperature/pressure registers every 200ms using async I/O.

**Alternatives considered:**
- 100ms polling — rejected: insufficient CRC retry budget
- Event-driven (X100 push) — not supported by this firmware

**Why this works for us**: 200ms latency is acceptable for our control loop;
async I/O lets us poll multiple devices concurrently.

**References:**
- See facts: "RTU mode timing"
- Conversation: 2024-11-15-modbus-setup.md
- Code: src/modbus/x100_client.py

---

## D2: Treat slave ID 10 as default; require explicit override

**Date**: 2024-11-15
**Made by**: laowang
**Status**: Active

After verification with ABC Agent that the documented "slave ID 1" is wrong
and actual default is 10, we hardcoded `DEFAULT_SLAVE_ID = 10` and require
explicit override via env variable for non-default installations.

**Why**: The vendor's docs and reality diverge. We trust verified vendor
statements over published docs.

**References:**
- See facts: "Modbus register map (X100)" → slave ID note
```

Conventions de format :

- chaque décision a un identifiant unique (`D1`, `D2`, …)
- champs obligatoires : Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- il faut énumérer les alternatives considérées
- il faut renvoyer aux facts et au code concernés

### `conversations/{date}-{slug}.md`

L'historique complet des conversations. Confer y archive automatiquement chaque fil.

```markdown
---
thread_id: thread_8f3a9c
peer: did:web:acme.com:agents:support
date: 2024-11-15
participants: [laowang, abc-industries-agent]
via: claude-code
status: closed
tags: [modbus, registers, x100]
summary: |
  Confirmed register map for X100 temperature and pressure sensors.
  Clarified function code recommendation and slave ID default.
---

# Modbus setup conversation

## laowang
Je dois intégrer le X100 en Modbus : 4 voies de température et 4 de pression, avec scrutation.

## ABC Agent
Cartographie des registres Modbus RTU :
- 0x40–0x47 température (4 voies)
- 0x48–0x4F pression (4 voies)
Je conseille un cycle de scrutation de 200 ms et le code de fonction 0x03 pour la lecture continue.

📎 Source: Manuel de communication du X100 v3.2 p.87

## laowang
La lecture continue pose-t-elle un problème de performance ? L'esclave risque-t-il de bloquer ?

## ABC Agent
Lire 8 registres d'affilée tient en une seule requête, donc rien ne bloque. Attention toutefois : le slave ID par défaut est 0x0A (10) et non 1 ; l'ancien manuel se trompe.

📎 Source: Guide d'installation du X100 p.12, FAQ #4
```

### Conventions de nommage des fichiers

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: nommés d'après leur usage, avec l'extension du langage

## Flux d'écriture et de lecture

### Chemin d'écriture

```
appel à ask_peer →
  le nuage Confer renvoie la réponse →
  le serveur MCP extrait les faits structurés →
  il les ajoute au facts.md local (s'il s'agit de faits nouveaux)
  il ajoute la conversation complète à conversations/
  il met à jour meta.json
  indice de commit local : suggérer à l'utilisateur git add .claude/peers/{slug}/
```

### Chemin de lecture

```
démarrage d'une session Claude Code →
  parcours de .claude/peers/*/ →
  le facts.md de chaque pair est donné à Claude Code dans le prompt système →
  Claude Code cite naturellement ces faits en écrivant du code
```

### Traitement des conflits

Si un même fait est vérifié plusieurs fois :

- la vérification la plus récente l'emporte
- si le nouveau résultat contredit l'ancien, **on n'écrase pas directement** : on ajoute une mention `⚠️ Conflict:` et on attend la décision de l'utilisateur

Par exemple :

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: Manuel de communication du X100 v3.2 p.12 (says 1)
  - Source: Guide d'installation du X100 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## Synchronisation vers le serveur

La mémoire de projet peut, en option, être synchronisée vers le serveur Confer (interrupteur côté utilisateur ; le local prime par défaut) :

```bash
confer sync push    # envoie le .claude/peers/ local
confer sync pull    # récupère la dernière version depuis le serveur (cas du travail en équipe)
```

Côté serveur, le stockage se fait dans la table `project_memory` (voir `docs/04-data-model.md`).

Pourquoi le local prime par défaut :
- la mémoire de projet est une information sensible (elle contient des décisions internes)
- le stockage local suffit, et git règle déjà la synchronisation à plusieurs
- le serveur n'est qu'une sauvegarde et le confort de « lire depuis un autre appareil »

## Comment les citations apparaissent

En générant du code, Claude Code ajoute automatiquement des commentaires de citation pour les faits venus de facts.md :

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: Manuel de communication du X100 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

Ainsi le code porte lui-même la chaîne de preuves du « pourquoi c'est écrit comme ça ».

## Vie privée et sécurité

- `.claude/` devrait rester hors du `.gitignore` par défaut (autrement dit, être commité dans git)
- mais les jetons d'authentification, clés privées et autres éléments sensibles ne s'écrivent jamais dans `.claude/peers/`
- si `.claude/confer.toml` contient un jeton, ce fichier-là est mis à part dans `.gitignore`
- si l'historique des conversations contient des secrets, ils sont caviardés automatiquement et signalés

## Critères de recette

- [ ] au démarrage, Claude Code charge correctement tous les `.claude/peers/*/facts.md` comme contexte
- [ ] après un `ask_peer`, facts.md est à jour en moins d'une seconde
- [ ] le format de fichier est lisible par un humain et analysable par une machine (les outils des deux côtés s'en servent)
- [ ] le diff git du markdown se lit clairement (pas un diff à la JSON)
- [ ] il tient au moins 1000 faits sans que les performances en pâtissent

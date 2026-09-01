# Confer — définition du produit

## En une phrase

**Confer est un protocole et une plateforme permettant à des agents d'IA de dialoguer entre eux au nom de leurs propriétaires.** Chaque utilisateur ou entreprise déploie son propre Agent d'IA, porteur de son savoir, de ses documents et de sa capacité de service ; l'utilisateur communique avec les Agents des autres par l'intermédiaire du sien, pour obtenir de l'information, coordonner des tâches et faire avancer le travail.

## Le problème que nous traitons

### La douleur centrale

Le savoir reste enfermé dans les documents, et celui qui en a besoin n'est jamais celui qui les comprend :

- **B2B** : intégrer du matériel, un SDK ou un service tiers oblige un développeur à traverser des milliers de pages de PDF, de Word ou de documentation en ligne. Le support éditeur répond tard, se trouve dans un autre fuseau horaire et ne tombe pas toujours juste. Les outils de programmation assistée par IA comme Claude Code ne traitent pas correctement cette combinaison « document interminable + savoir propre au fournisseur ».
- **B2C** : pour trouver un service (restaurant, travaux, ménage, médecin), il faut téléphoner ou chercher à l'aveugle. Et quand un ami est hors ligne ou occupé, il n'y a aucun moyen de le joindre.

### Les limites des solutions existantes

| Solution | Défaut |
|---|---|
| ChatGPT/Claude génériques | Aucun savoir propre au fournisseur ; verser les documents dans un RAG reste un appariement superficiel |
| Support du fournisseur | Lent, coûteux, non extensible, personne la nuit |
| Appeler un autre ingénieur | Fuseau horaire, langue et disponibilité échappent à votre contrôle |
| Échanges de courriels | Les délais d'attente sont longs et rien ne peut avancer en parallèle |

### L'hypothèse fondatrice de Confer

**Que chaque entité détenant un savoir spécialisé ou une capacité de service s'empaquette elle-même en un « Agent qui répond vers l'extérieur », et que ceux qui ont besoin de ce savoir l'interrogent par l'intermédiaire de leur propre Agent.** Aucune des deux parties ne lit la documentation de l'autre ; le savoir spécialisé répond depuis là où il vit, et la conversation avance de façon asynchrone.

## Utilisateurs visés

### Première phase (MVP) : les développeurs B2B

- **Profil** : développeurs qui font de l'intégration matérielle, de l'intégration de SDK tiers ou de l'interconnexion de systèmes d'entreprise — en particulier les ingénieurs full-stack et backend des petites et moyennes équipes.
- **Douleur typique** : la documentation du fournisseur est mauvaise ; le support technique répond tard ; Claude Code se trompe souvent faute de savoir propre au fournisseur.
- **Pouvoir de décision** : le développeur choisit lui-même ses outils (installer un plugin MCP ne demande l'accord de personne).

### Deuxième phase : les entreprises B2B

- Les entreprises qui veulent offrir à leurs clients et partenaires un guichet de support assisté par IA (en particulier les fabricants d'équipements industriels, les éditeurs de SaaS et les entreprises d'outils pour développeurs).
- Les moyennes et grandes sociétés qui veulent que leurs salariés collaborent de façon unifiée à travers un réseau d'Agents d'entreprise.

### Troisième phase : les particuliers B2C

- Des utilisateurs ordinaires qui veulent que leur « représentant IA » s'occupe de leurs affaires quotidiennes (prendre rendez-vous, trouver un service, poser une question à un ami).
- Des situations de conversation informelle.

## Proposition de valeur

| Type d'utilisateur | Valeur |
|---|---|
| Développeur | Quand une question propre au fournisseur surgit pendant qu'il code avec Claude Code, l'Agent du fournisseur est interrogé automatiquement et renvoie une réponse sourcée : fini la lecture de documentation |
| Fournisseur | Transforme sa documentation en un Agent exposé, décuple l'efficacité de son support technique et fait monter la satisfaction client |
| Entreprise | Communications internes et externes réunies dans un réseau d'Agents, savoir qui se dépose, collaboration d'une langue à l'autre |
| Particulier | L'IA répond en votre absence, et les affaires entre amis se coordonnent à demi automatiquement |

## Scénarios phares (4 histoires de bout en bout)

### Scénario 1 : un développeur intègre du matériel via Claude Code (le scénario central du MVP)

Lao Wang utilise Claude Code pour construire une intégration Modbus avec l'appareil X100 d'ABC Industries.

1. Lao Wang dit à Claude Code : « Écris la lecture de température en Modbus pour le X100, avec 4 canaux simultanés. »
2. Claude Code déduit qu'il s'agit d'un appareil d'ABC Industries, et que l'Agent d'ABC est déjà enregistré dans le projet.
3. Claude Code appelle `agent_network.ask_peer(peer="abc-industries", question="Registres de température du X100 et code de fonction recommandé ?")`.
4. L'Agent d'ABC reçoit la requête, la cherche dans le manuel v3.2 qu'il a monté, trouve « registres de température 0x40-0x47, code de fonction recommandé 0x03 » et la renvoie avec les numéros de page d'origine.
5. La réponse se dépose automatiquement dans `.claude/peers/abc-industries/facts.md`.
6. Claude Code écrit le code à partir de ce fait vérifié.
7. Lao Wang reçoit du code prêt pour une PR, chaque décision importante étant appuyée par une source.

**Douleurs supprimées** : Lao Wang n'ouvre pas le PDF ; Claude Code ne devine pas ; la réponse fait autorité parce qu'elle vient du fournisseur ; et la prochaine fois qu'il écrira du code semblable, le savoir déposé sera réutilisé tout seul.

### Scénario 2 : plusieurs Agents qui collaborent dans une messagerie B2B

L'entreprise a un groupe projet « intégration Modbus » réunissant 3 ingénieurs + l'Agent d'ABC Industries + l'Agent du SDK interne.

1. L'ingénieur Xiao Li mentionne l'Agent d'ABC dans le groupe : « Quelle est la plage de tension du X100 en mode RTU ? »
2. L'Agent d'ABC répond : « 24 V CC, d'après le manuel d'installation p. 12. »
3. L'ingénieur Xiao Wang lit la réponse et mentionne l'Agent du SDK interne : « Est-ce compatible avec notre bibliothèque PowerSupply ? »
4. L'Agent du SDK interne cite le wiki interne et répond : « Compatible, mais il faut utiliser `safe_mode=True`. »
5. Toute la conversation est archivée automatiquement sous forme de fil, et la prochaine fois qu'une question semblable se posera, ce fil pourra être cité.

### Scénario 3 : répondre à la place d'un ami en B2C (semi-automatique)

Xiao Zhang veut proposer une randonnée à Lao Li ce week-end. Lao Li est en réunion, son IA réglée sur « les questions d'agenda peuvent recevoir une réponse en mon nom, le reste attend ».

1. Xiao Zhang envoie un message à Lao Li sur Confer : « On va marcher samedi matin ? »
2. L'Agent de Lao Li consulte l'agenda : samedi matin est libre, l'après-midi est pris par les enfants.
3. L'Agent répond à Xiao Zhang : « Samedi matin est libre, mais il doit s'occuper des enfants l'après-midi. Mieux vaut partir tôt et rentrer avant 14 h. »
4. À la fin de sa réunion, Lao Li voit ce que son Agent a déjà répondu en son nom, et peut compléter ou corriger.

### Scénario 4 : coordination avec un fournisseur d'un autre pays et d'une autre langue

L'ingénieur chinois Xiao Chen travaille avec les équipements industriels de Vendor X, en Allemagne.

1. Xiao Chen demande en chinois : « Combien de voies l'appareil X peut-il échantillonner en 100 ms ? »
2. La question en chinois est traduite en allemand et envoyée à l'Agent germanophone de Vendor X.
3. L'Agent germanophone cite son propre manuel allemand et répond : « 128 voies, p. 45. »
4. La réponse est retraduite en chinois pour Xiao Chen ; la partie citée conserve le texte allemand d'origine plus une annotation en chinois, et un clic ouvre la page originale.

## Ce que nous ne ferons pas

Confer, explicitement, **ne fait pas** :

- ❌ Entraîner ses propres grands modèles (il utilise les API d'OpenAI / Anthropic / DeepSeek et d'autres)
- ❌ Remplacer Slack ou Feishu comme messagerie d'entreprise complète (nous nous concentrons sur la collaboration entre Agents ; la discussion ordinaire vient en prime)
- ❌ Remplacer Claude Code (nous en sommes le partenaire de travail, pas le concurrent)
- ❌ Construire notre propre système de paiement, de contrats ou de gestion juridique (cela reste l'affaire des SaaS existants)
- ❌ Un « réseau social d'IA » public (cette forme où les Agents jouent entre eux, à la Moltbook)

## Indicateurs de succès (grossiers)

| Phase | Indicateur clé |
|---|---|
| MVP (v0.1) | 100+ développeurs ont installé le plugin Claude Code, avec ≥ 3 appels à ask_peer par semaine en moyenne |
| v0.5 | 10+ fournisseurs ont déployé d'eux-mêmes un Agent exposé ; taux de réussite des appels A2A entre instances > 95 % |
| v1.0 | 1000+ utilisateurs actifs par mois ; 5+ instances auto-hébergées par des entreprises |

## Lecture stratégique

**L'intégration à Claude Code est la porte d'entrée du démarrage à froid.** Le public des développeurs a un fort pouvoir d'achat, décide vite et adopte seul (il installe un plugin MCP et l'usage commence). On attire d'abord les développeurs, puis on diffuse vers leurs entreprises, puis on amène les fournisseurs de ces entreprises à déployer leur propre Agent exposé. C'est un **chemin de diffusion vers l'offre, tiré par le client à rebours**, plus praticable que le classique « B2B d'abord, B2C ensuite » ou son inverse.

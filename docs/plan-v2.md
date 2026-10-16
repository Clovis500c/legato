# Music App v2 : plan proposé (à valider)

Statut : **phases 1 et 2 livrées** (16/10/2026) : refonte Hi-Fi, thèmes, bouclier anti-pub, playlists perso, dossiers locaux, ajout par lien YouTube. Complète, raye ou commente directement ce fichier, ou réponds dans le chat.
Maquettes : Figma, fichier « Bow Game / Music App », page **« Music App v3 — Hi-Fi »**. La page v2 « Apple » est abandonnée.

## 0. Tes décisions (à remplir)

| # | Question | Ma proposition | Ta réponse |
|---|---|---|---|
| 1 | Direction visuelle | **Hi-Fi** : appareils Braun de Dieter Rams. Papier chaud et encre, un seul accent, voyants, boutons ronds, afficheurs en mono | |
| 2 | Accent par défaut | Orange signal `#FF5A1F`. 6 accents au choix + couleur perso, jamais de dégradé | |
| 3 | Thèmes | Papier par défaut. 6 thèmes prêts à l'emploi (Papier, Graphite, Studio, Aluminium, Bakélite, Sauge) + Système + **éditeur de thème** | |
| 4 | Lecteur | Deck pleine largeur en bas (position réglable : bas, haut ou flottant) + plein écran | |
| 5 | Clé API YouTube (gratuite, sans connexion) pour la recherche | Oui | |
| 6 | Apple Developer (99 $/an) pour tenter la lecture Apple Music complète | Non pour l'instant : aperçus et bascule YouTube | |
| 7 | Spotify Premium | Pas maintenant : liens, aperçus et bascule YouTube | |
| 8 | Nom de l'app | « Music App » provisoire | |

## 1. Ce qui marche sans être connecté (vérifié le 15/10/2026)

| Service | Ajouter un titre | Lecture complète | Avec un compte en plus |
|---|---|---|---|
| **YouTube** | Recherche avec une clé API gratuite (environ 100 recherches par jour). Lien collé : oEmbed, sans clé | **Oui** : lecteur officiel embarqué (prouvé dans l'app) | Import des playlists et des « J'aime », export de playlists |
| **Apple Music** | Recherche dans le catalogue public iTunes, **sans clé** (environ 20 requêtes/min). Lien collé : recherche par id | Aperçu 30 s, puis bascule automatique sur YouTube | Lecture complète : MusicKit + Apple Developer + abonnement + DRM. Risque élevé dans WebView2 |
| **Spotify** | **Lien collé seulement** (oEmbed). Sans Premium, toute l'API Spotify refuse les requêtes en mode dev, recherche comprise (règle de février 2026) | Aperçu par le lecteur Spotify officiel, puis bascule YouTube | Premium : pilotage de l'app Spotify (Spotify Connect, cf. `playback.md`) |
| **Fichiers locaux** | Dossiers surveillés, glisser-déposer | Oui (moteur Rust sans blanc entre titres) | — |

Règle de lecture : pour chaque titre, on joue la meilleure source disponible. **Fichier local, puis YouTube (complet), puis service connecté, puis aperçu 30 s.**
« Trouver les versions » relie les titres entre services (ISRC, ou titre + artiste + durée) et utilise le quota YouTube avec un cache.

## 2. Données (crates/core)

- `tracks` reste la fiche commune (titre, artiste, album, durée, ISRC).
- **Nouveau** `track_sources(track_id, source, source_id, url, playable: full|preview|none, preview_url)`, qui remplace `Track.ids`.
- **Nouveau** `library(track_id, added_at, origin)` : on peut ajouter un titre sans qu'il soit dans une playlist.
- Playlists : `kind = perso | importée(source)`, `playlist_items(position, track_id, added_at)`.
  Une playlist importée est un miroir en lecture seule, avec un bouton « Dupliquer en playlist perso ».
- Migrations SQLite versionnées (`user_version`). Export et import de sauvegarde en JSON.

## 3. Phases (une étape testée = un petit commit)

**Phase 1 : refonte visuelle « Hi-Fi » et moteur de personnalisation** (L)
- Design system :
  - jetons par thème (Papier, Graphite, Studio), accent variable, aucun dégradé ;
  - polices Schibsted Grotesk (texte, titres) et Geist Mono (afficheurs, étiquettes), toutes deux sous licence libre OFL et embarquées ;
  - icônes Phosphor ;
  - composants : bouton rond (principal, encre, contour, relief), filtre à voyant, afficheur, molette de volume, échelle graduée,
    interrupteur, contrôle segmenté rond, liste de titres, deck, groupe de réglages.
- Barre de titre personnalisée (`decorations: false`, zone de déplacement, boutons Windows).
- Écrans : Accueil, Morceaux, Albums, Artistes, Récemment ajoutés, Playlist, Ajouter, En lecture plein écran, Réglages.
- Moteur de réglages : un seul schéma typé (Rust + TS), enregistré en local, appliqué en direct par des variables CSS.

**Personnalisation (au cœur du projet, sans devenir incompréhensible)**
- Apparence :
  - thème ;
  - accent ;
  - forme des pochettes (net, arrondi, vinyle) ;
  - densité des listes ;
  - taille du texte ;
  - position du lecteur ;
  - afficheur numérique ;
  - molette ou barre de volume ;
  - échelle graduée ;
  - colonnes de la liste (choisir et ordonner).
- Accueil en sections : afficher, masquer, réordonner (Reprendre, Ta semaine, Récemment ajoutés, Tes playlists, À redécouvrir…), avec des options par section.
- Barre latérale : réordonner et masquer les entrées, épingler des playlists.
- Thèmes :
  - 6 thèmes prêts à l'emploi + Système ;
  - **éditeur** :
    - 8 couleurs avec leur code hex ;
    - police : Hi-Fi, Neutre ou Éditorial ;
    - arrondis de 0 à 16 px ;
    - lueur des voyants ;
    - teinte de la pochette ;
    - contraste AA vérifié en direct, avec un avertissement si un texte devient illisible ;
  - dupliquer, exporter ou importer en `.theme`.
- Écrans corrigés d'après la revue utilisateurs (`docs/ui-review.md`) :
  - actions visibles au survol ;
  - panneau droit ancrable (file, infos, paroles locales) ;
  - grande pochette ;
  - file avec sélection multiple ;
  - aléatoire vrai ;
  - dossiers de playlists ;
  - badges CLIP / LIVE ;
  - teinte de la pochette.
- Pour rester lisible :
  - recherche dans les réglages ;
  - aperçu en direct ;
  - « Réinitialiser » partout ;
  - réglages avancés masqués par défaut ;
  - réglages classés par écran (Apparence, Lecture, Bibliothèque, Sources, Raccourcis, Notifications, Avancé).

**Phase 2 : bibliothèque universelle et playlists perso** (L)
- Migration du schéma ; ajout depuis une recherche ou un lien (Ctrl+V n'importe où = lien détecté).
- Playlists perso : créer, renommer, réordonner par glisser-déposer, dupliquer, supprimer, sélection multiple, menu « Ajouter à… ».
- Dossiers locaux : scan et tags (crate `lofty`), surveillance des changements (crate `notify`).

**Phase 3 : recherche multi-catalogues** (M)
- Catalogue iTunes (sans clé), YouTube (clé, compteur de quota affiché), fichiers locaux ; doublons fusionnés par `match_key` ; cache.
- Spotify : liens seulement (titre et pochette par oEmbed, artiste complété par recherche ; à prototyper).

**Phase 4 : lecture intelligente** (L)
- File d'attente unique pour toutes les sources (fichier local, YouTube, aperçu).
- Aperçus Apple lus par le moteur Rust (téléchargés côté Rust, pas depuis l'interface), avec un lien « Écouter sur Apple Music ».
- Badges « Aperçu 30 s » ; bandeau « Trouver les versions » ; choix « Écouter via » dans l'écran En lecture.

**Phase 5 : comptes (optionnels)** (M)
- YouTube : import (existe déjà), export d'une playlist perso (quota : environ 190 titres par jour).
- Spotify Connect si Premium un jour (plan écrit). Prototype MusicKit si compte Apple Developer.

**Phase 6 : finitions** (M)
- Raccourcis clavier, touches multimédia et panneau média de Windows (crate `souvlaki`), mini-lecteur, icône de zone de notification.
- Mises à jour automatiques (`tauri-plugin-updater`, demande de signer l'app), installeur, performance (50 000 titres), accessibilité (contraste AA, navigation clavier).

**Bonus « au max » (choisis)** : playlists intelligentes (règles), statistiques d'écoute, détecteur de doublons,
radio de titres proches (clé Last.fm), scrobbling Last.fm, minuteur de sommeil, fondu enchaîné et égaliseur (fichiers locaux).
Écarté : les paroles (droits d'auteur).

## 4. Limites fixes

- Jamais de téléchargement ni d'extraction d'audio YouTube ou Spotify, jamais de lecteur caché (la vidéo YouTube reste visible, minimum 200×200).
- Pas de contournement de Premium ni des DRM. Quotas respectés, aucun serveur à nous.

## 5. Risques à prototyper en premier

1. DRM dans WebView2 : lecture complète Spotify et Apple dans leurs lecteurs officiels. Probablement bloquée (Widevine non garanti) ;
   le plan B (aperçus + YouTube) est déjà prévu.
2. Quota YouTube de recherche (100 par jour) : cache, regroupement des recherches, ta propre clé.
3. Métadonnées des liens Spotify sans API (oEmbed ne donne que le titre et la pochette).
4. Pochettes : affichées depuis les API des services (YouTube, iTunes), mises en cache en local.

## 6. Maquettes livrées (page Figma « Music App v3 — Hi-Fi »)

1. `v3 / Accueil — Papier` : sections Reprendre, Ta semaine, Récemment ajoutés, Tes playlists ; panneau « Personnaliser l'accueil » ouvert.
2. `v3 / Morceaux — Papier` :
   - filtres à voyant ;
   - actions au survol ;
   - **panneau droit** : grande pochette, file avec sélection multiple, « Aléatoire vrai » ;
   - dossier de playlists ;
   - deck avec afficheur et molette.
3. `v3 / Playlist — Papier` : en-tête éditorial, boutons ronds, ligne d'état « 21 en entier · 3 en aperçu ».
4. `v3 / Ajouter — Papier` : console de recherche (catalogues à voyant), lien collé, catalogues, zone de dépôt.
5. `v3 / En lecture — Graphite` : vidéo YouTube visible, afficheur 01:12, échelle graduée, sélecteur d'entrée, molette, file d'attente.
6. `v3 / Réglages Apparence — Papier` : thèmes, accents, pochettes, densité, lecteur, colonnes, aperçu en direct.
7. `v3 / Morceaux — Graphite perso` : même écran avec un thème perso (Graphite, accent jaune, pochettes vinyle, compact, colonne Écoutes).
8. `v3 / Thèmes — Papier` : galerie des 7 thèmes, tes thèmes, éditeur (couleurs, police, arrondis, voyants, teinte, contraste vérifié).
9. `v3 / En lecture — Teinte pochette` : l'écran de lecture en aplat de la couleur d'*After Hours*.
   L'écran **Ajouter** a aussi reçu les badges AUDIO OFFICIEL et CLIP et le filtre « Masquer les vidéos non officielles ».

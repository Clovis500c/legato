# Music App v2 : plan proposé (à valider)

Statut : **proposition**. Complète, raye ou commente directement ce fichier, ou réponds dans le chat.
Maquettes : Figma, fichier « Bow Game / Music App », page **« Music App v2 — Apple »**.

## 0. Tes décisions (à remplir)

| # | Question | Ma proposition | Ta réponse |
|---|---|---|---|
| 1 | Couleur d'accent | Indigo `#5856D6` (`#7D7AFF` en sombre), proche du violet actuel | |
| 2 | Thème | Clair par défaut, sombre automatique (suit Windows) | |
| 3 | Lecteur | Capsule flottante translucide en bas + plein écran | |
| 4 | Fond translucide (Mica Windows 11) sur la barre latérale | Oui, avec un fond uni en repli | |
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

**Phase 1 : refonte visuelle « Apple clean »** (M)
- Design system : jetons clair et sombre, Inter (SF Pro n'est pas autorisée hors des plateformes Apple), icônes fines, composants
  (barre latérale, contrôle segmenté, bouton pilule, liste de titres, capsule de lecture, groupe de réglages, interrupteur).
- Barre de titre personnalisée (`decorations: false`, zone de déplacement, boutons Windows) ; Mica sur Windows 11 (`windowEffects`, à vérifier).
- Écrans : Morceaux, Albums, Artistes, Récemment ajoutés, Playlist, Ajouter, Sources et comptes, En lecture plein écran.

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
4. Mica et fenêtre transparente sous Windows 10 : repli en fond uni.

## 6. Maquettes livrées (page Figma « Music App v2 — Apple »)

1. `v2 / Morceaux — Clair` : bibliothèque unifiée, colonne « Disponible sur », badges « Aperçu 30 s », capsule de lecture.
2. `v2 / Playlist perso — Clair` : playlist mixte, mosaïque, « Exporter vers… », bandeau de disponibilité.
3. `v2 / Ajouter de la musique — Clair` : recherche multi-catalogues, lien collé, état des sources.
4. `v2 / En lecture — Sombre` : vidéo YouTube visible, choix « Écouter via », file d'attente.
5. `v2 / Sources et comptes — Clair` : réglages groupés façon Apple.
6. `v2 / Morceaux — Sombre` : même écran en mode sombre.

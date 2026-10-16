# Revue UI : ce que les utilisateurs aiment et détestent (octobre 2026)

Recherche faite le 16/10/2026 dans les forums officiels, les tests et les annonces (sources en bas).
Les avis de forum sont anecdotiques : on retient les plaintes qui reviennent souvent.

## 1. Par plateforme

| Plateforme | Ce qui plaît | Ce qui énerve |
|---|---|---|
| **Spotify** | Glisser-déposer un titre sur une playlist ; paroles bien placées sous la pochette, traduites, hors ligne | Bureau « pensé pour mobile » : peu dense, espace gâché ; panneaux qui ne tiennent pas ensemble (paroles, file, bibliothèque) ; pochette minuscule et non redimensionnable sur grand écran ; miniatures imposées dans la liste des playlists ; contrôle « répéter » caché dans un menu (remis après la grogne) ; aléatoire qui repasse les 30 mêmes titres ; ordre perso perdu dans les dossiers |
| **Apple Music** | Interface propre quand on connaît ; métadonnées riches (classique : compositeur, chef, mouvements) ; continuité entre appareils | Trop de clics pour des actions autrefois visibles ; destinations cachées dans des menus ; recherche qui exige le terme exact ; refonte « Liquid Glass » qui divise |
| **YouTube Music** | Catalogue immense (live, remix, faces B) ; recherche par paroles ou fredonnement ; file synchronisée entre appareils (2026) | File peu fiable (pas de suppression multiple, « lire ensuite » qui bugue) ; bibliothèque mal rangée (artiste = liste de titres, onglets séparés) ; vidéos et musique mélangées ; réglage « boucle » perdu d'une file à l'autre |
| **Tidal** | Sobre, centré sur la musique, cohérent sur toutes les plateformes | Un peu complexe, peu personnalisable |
| **Deezer** | Simple et familier ; **thèmes et palettes de couleurs** (nov. 2025) ; **accès rapide** épinglé en haut de l'accueil (suggestions + choix manuel) | Jugé basique, peu « fun » |
| **Plexamp** | Écran de lecture qui prend les couleurs de la pochette (« UltraBlur »), une identité par album | — |
| **foobar2000 / MusicBee** | Mise en page entièrement modulable, skins, l'app « à sa main » | Déroutant au début : trop d'options d'un coup, skins réservés aux bricoleurs |

## 2. Les leçons

1. **Un vrai logiciel de bureau** : dense, des colonnes, de la place utile. Pas une app de téléphone agrandie.
2. **Rien de caché** : les actions courantes visibles (au survol) et au clic droit. Répéter et aléatoire toujours à l'écran.
3. **Des panneaux qui cohabitent** : bibliothèque, file d'attente et infos ouverts ensemble, avec une largeur réglable.
4. **Une pochette à la taille qu'on veut.**
5. **Une file fiable** : sélection multiple, réordonner, retirer, « lire ensuite », vider.
6. **Un aléatoire honnête** : vrai hasard sans répétition, au choix.
7. **Une bibliothèque rangée** : tris, dossiers de playlists, ordre perso conservé.
8. **Musique d'abord** : clips, lives et reprises signalés et filtrables.
9. **Personnaliser sans se perdre** : thèmes prêts à l'emploi, éditeur guidé, aperçu, « Réinitialiser ».
10. **Une identité par écran de lecture** : couleurs tirées de la pochette, en aplat (pas de dégradé).

## 3. Revue des maquettes v3

| Leçon | v3 | Correction |
|---|---|---|
| 1. Dense | ✓ Liste à colonnes, densité réglable | Mode compact par défaut proposé aux grandes bibliothèques |
| 2. Rien de caché | ✗ Aucune action sur les lignes de Morceaux et de Playlist | **Actions au survol** (lire, ajouter à une playlist, plus) + menu clic droit complet |
| 3. Panneaux | ✗ La file n'existe qu'en plein écran | **Panneau droit ancrable** (file d'attente, infos et crédits), redimensionnable, ouvert en même temps que la liste |
| 4. Pochette | ✗ Taille fixe | **Grande pochette dans le panneau droit** + réglage de taille |
| 5. File fiable | ✗ Pas d'actions de file | Sélection multiple avec barre d'actions : lire ensuite, retirer, vider |
| 6. Aléatoire | ✗ Non défini | Réglage « Aléatoire : vrai hasard / équilibré par artiste » |
| 7. Rangement | ~ Tri présent, pas de dossiers | **Dossiers de playlists** dans la barre latérale ; option « miniatures des playlists » activable ou non |
| 8. Musique d'abord | ✗ Résultats YouTube sans type | Badges **CLIP / LIVE / REPRISE** + filtre « Masquer les vidéos non officielles » |
| 9. Personnaliser | ~ Apparence complète mais 4 thèmes fixes | **Galerie de 6 thèmes + éditeur de thème** (couleurs, police, arrondis, voyants, contraste vérifié, export `.theme`) |
| 10. Identité | ✗ | Option **« Teinte de la pochette »** : fond du deck et de l'écran de lecture en aplat de la couleur dominante |
| Lisibilité | ✗ Petits textes trop pâles (encre 4 sur papier) | Encre 4 réservée aux éléments décoratifs ; les textes passent en encre 3 |

**Paroles** : très appréciées ailleurs, mais aucune source sous licence n'est accessible gratuitement.
On les affiche seulement depuis les fichiers locaux (tags `USLT` ou fichiers `.lrc` à côté du fichier audio).

## 4. Thèmes

- **Prêts à l'emploi** :
  - Papier (clair chaud, orange) ;
  - Graphite (sombre chaud, orange) ;
  - Studio (noir pur OLED, rouge) ;
  - Aluminium (clair froid, bleu) ;
  - Bakélite (brun profond, ambre) ;
  - Sauge (clair vert de gris, vert sapin) ;
  - Système (suit Windows).
- **Éditeur** :
  - 8 couleurs (fond, panneau, surface, encre ×3, lignes, accent) avec code hex ;
  - police : Hi-Fi, Neutre ou Éditorial ;
  - arrondis de 0 à 16 px ;
  - voyants : lueur oui ou non ;
  - teinte de la pochette ;
  - **contraste vérifié en direct** (AA), avec un avertissement si un texte devient illisible.
- **Partage** : dupliquer, renommer, exporter et importer en fichier `.theme` (JSON).

## Sources

- Spotify :
  - [nouvelle UI PC critiquée](https://community.spotify.com/t5/Desktop-Windows/UI-customisation-New-PC-UI-sucks/td-p/7388808) ;
  - [« New Desktop UI is terrible »](https://community.spotify.com/t5/Your-Library/What-s-up-with-this-new-desktop-UI/m-p/5525644) ;
  - [demande de retour à l'ancienne interface](https://community.spotify.com/forum/en/discussion/7446756/please-consider-restoring-the-previous-spotify-desktop-experience) ;
  - [répéter remis après la grogne](https://www.phonearena.com/news/spotify-repeat-button-now-playing-screen-app-update_id114354) ;
  - [ordre perso des dossiers](https://community.spotify.com/t5/Ongoing-Issues/Custom-Order-sorting-option-missing-inside-folders/idi-p/7403172/highlight/true) ;
  - [plaintes sur l'aléatoire](https://www.bgr.com/2216137/most-common-customer-complaints-about-spotify/) ;
  - [paroles améliorées](https://techcrunch.com/2026/02/04/spotify-upgrades-its-lyrics-feature-with-offline-access-more-translations).
- Apple Music :
  - [pourquoi les utilisateurs partent](https://www.bgr.com/2257028/why-users-ditch-apple-music/) ;
  - [avis Trustpilot](https://ca.trustpilot.com/review/applemusic.com).
- YouTube Music :
  - [test 2026](https://www.lissen.com/blog/reviews/youtube-music-review-2026) ;
  - [avis utilisateurs](https://justuseapp.com/en/app/1017492454/youtube-music/reviews) ;
  - [file synchronisée](https://www.techradar.com/audio/audio-streaming/youtube-music-just-got-a-big-queue-upgrade-that-users-have-wanted-for-years-and-now-apple-music-fans-are-demanding-the-same).
- Tidal et Deezer :
  - [comparatif 2026](https://soundiiz.com/blog/deezer-vs-tidal-which-music-streaming-service-is-best-in-2026/) ;
  - [test Deezer](https://www.techradar.com/reviews/deezer) ;
  - [thèmes et accès rapide Deezer](https://newsroom-deezer.com/2025/11/deezer-now-lets-you-choose-look-and-layout-of-the-app/).
- Plexamp : [UltraBlur](https://medium.com/@elanf/plexamp-v3-9af3b10063b4).
- foobar2000 et MusicBee : [discussion Head-Fi](https://www.head-fi.org/threads/who-else-is-using-foobar2000-in-2025.978240/page-2), [comparatif](https://school-of-privacy.com/article/musicbee-vs-foobar2000/).

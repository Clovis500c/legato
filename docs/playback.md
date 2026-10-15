# Lecture audio : prototypes et plan

État au 15/10/2026. YouTube et fichiers locaux : faits et testés sous Windows (WebView2). Spotify : plan seulement.

## YouTube : lecteur officiel embarqué

**Montage retenu**
- iframe `https://www.youtube.com/embed/<id>?enablejsapi=1&autoplay=1&playsinline=1&origin=<origine de l'app>`
  avec `referrerpolicy="strict-origin-when-cross-origin"` (`ui/src/features/player/youtube.ts`, `PlayerBar.tsx`).
- Piloté par `postMessage`, le protocole qu'utilise `iframe_api` en interne (`listening`, `command`, `infoDelivery`, `onError`).
  On ne charge pas `iframe_api` : un script distant dans l'origine de l'app aurait accès à l'IPC Tauri.
- CSP : seul ajout, `frame-src https://www.youtube.com`.
- Règles YouTube : le lecteur reste visible (356×200, minimum 200×200), ses contrôles aussi. On n'extrait aucun audio
  et on ne lit rien en arrière-plan caché.

**Erreur 153 (pas de `Referer`) : mesure réelle**
Build debug (`pnpm tauri build --debug --no-bundle`), origine `http://tauri.localhost`, CSP de l'app, pilotage par le protocole DevTools de WebView2 :

| `referrerpolicy` de l'iframe | Résultat |
|---|---|
| `strict-origin-when-cross-origin` (retenu, aussi la valeur par défaut de Chromium) | lecture OK : état 1, temps qui avance, pause, seek, fin → titre suivant |
| `no-referrer` | `onError 153` |

C'est donc le `Referer: http://tauri.localhost/` qui débloque la lecture. Sous Windows, aucun réglage Tauri ni plugin n'est nécessaire.
On fixe quand même la politique sur l'iframe : une balise meta ou un en-tête ajouté plus tard ne peut plus la casser sans qu'on le voie.

**Options écartées (si YouTube durcit)**

| Option | Effet | Coût |
|---|---|---|
| `useHttpsScheme: true` (fenêtre) | origine `https://tauri.localhost` | l'origine change, donc le localStorage, l'IndexedDB et les cookies de la webview sont perdus pour les installations existantes (rien chez nous aujourd'hui) ; Windows et Android seulement |
| `Referer` forcé via `WebResourceRequested` de WebView2 (`https://dev.musicapp.desktop`) | suit à la lettre la règle YouTube pour les apps desktop (en-tête `Referer` = identifiant d'app en HTTPS) | code propre à Windows (`webview2-com`), à refaire pour chaque plateforme |
| `tauri-plugin-localhost` | toute l'UI servie sur `http://localhost:PORT` | serveur ouvert à tous les processus locaux, IPC exposé à une origine http ordinaire ; déconseillé par Tauri |
| Page relais sur `127.0.0.1` | `Referer` loopback pour la seule iframe | petit serveur loopback, double iframe, messages à relayer |

**Risques ouverts**
- macOS et Linux (non testés) : l'origine `tauri://localhost` n'enverra probablement aucun `Referer`, donc 153 probable.
  Piste : la page relais loopback, qui laisse la fenêtre principale sur l'origine Tauri.
- Le protocole `postMessage` n'est pas documenté, mais il est stable depuis des années et des lecteurs comme vidstack s'en servent.
  S'il casse : charger `iframe_api` dans une iframe isolée, sans accès à l'IPC.
- Une vidéo non intégrable renvoie l'erreur 101 ou 150, affichée dans l'alerte de l'app.

## Fichiers locaux : `crates/player`

- rodio 0.23 (décodage symphonia) : mp3, flac, wav, ogg/vorbis, m4a/aac.
- Le moteur tourne sur un thread dédié qui possède la sortie audio (le flux cpal n'est pas `Send` sur toutes les plateformes).
  Il reçoit les commandes par canal et vérifie les fins de morceau toutes les 100 ms.
- Gapless : dès qu'un morceau démarre, le suivant est ajouté au `Player` rodio, qui enchaîne les sources sans trou.
  Le décodeur retire le remplissage de l'encodeur (option gapless active par défaut). La logique de file (`Queue`) a ses tests unitaires.
- Un fichier illisible est sauté et l'erreur s'affiche.
- IPC : `player` (`play`, `toggle`, `seek`, `next`, `prev`, `volume`, `stop`) et `player_status`, interrogé 4 fois par seconde par la PlayerBar.
- Entrée : on glisse des fichiers audio sur la fenêtre, triés par nom. Pas encore d'import de dossier dans la bibliothèque.
- Testé dans l'app compilée : lecture, pause, seek, enchaînement automatique, précédent, volume.
- Limites : pas d'opus ; titre = nom de fichier (tags non lus) ; position obtenue par interrogation périodique, pas par événements.

## Spotify : plan (rien d'implémenté)

Le Web Playback SDK dans l'app est exclu. On pilote l'app Spotify officielle (desktop, mobile ou enceinte) par **Spotify Connect**,
via les endpoints Player de la Web API. L'audio sort de l'app Spotify ; nous n'envoyons que des commandes.

**Prérequis**
- Premium côté utilisateur : la doc de `PUT /me/player/play` indique « This API only works for users who have Spotify Premium ».
- Premium côté propriétaire du Client ID : obligatoire en mode dev depuis février 2026. Le guide de migration de février 2026 ne touche à aucun endpoint Player.
- Nouveaux scopes `user-read-playback-state` et `user-modify-playback-state`, donc une reconnexion au premier usage.

**Endpoints**

| Besoin | Appel |
|---|---|
| Choisir l'appareil | `GET /me/player/devices` |
| Transférer la lecture | `PUT /me/player` `{ device_ids: [id], play: false }` |
| Lire un titre ou une playlist | `PUT /me/player/play?device_id=…` `{ uris: ["spotify:track:…"] }` ou `{ context_uri, offset: { position } }` |
| Transport | `PUT /me/player/pause`, `POST /me/player/next`, `POST /me/player/previous`, `PUT /me/player/seek?position_ms=`, `PUT /me/player/volume?volume_percent=` |
| État pour la barre | `GET /me/player` (`is_playing`, `progress_ms`, `item`) |
| File d'attente | `POST /me/player/queue?uri=` |

**Intégration**
- `crates/connectors/src/spotify.rs` : méthodes Player sur `Spotify`, testées avec mockito comme le reste du connecteur.
- `src-tauri` : une commande `spotify_player(cmd)` sur le modèle de `player`.
- UI : `NowPlaying` gagne `spotifyUri` et le store route les commandes vers Spotify. On interroge `GET /me/player` toutes les 1 à 2 s
  et on interpole la position entre deux appels, pour ménager le quota.
- Aucun appareil actif : ouvrir `spotify:` avec l'opener, interroger `/devices` quelques secondes, sinon afficher « Ouvre Spotify sur un appareil ».
- Erreurs : `403` (Premium requis) donne un message clair et un bouton désactivé ; `404` (pas d'appareil) relance la procédure ci-dessus ;
  `429` respecte `Retry-After`.
- Repli sans Premium : si le titre a aussi un id YouTube (matching ISRC ou titre+artiste), le lire dans le lecteur YouTube.
  C'est déjà le cas aujourd'hui pour tout titre relié.
- Validation réelle impossible sans compte Premium : tests mockito d'abord, puis essai sur un compte Premium.

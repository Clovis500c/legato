# Music App — brief de départ

## Vision
App desktop (Electron + React + TypeScript) qui permet à n'importe qui de connecter ses propres comptes
musicaux (Spotify, YouTube Music, fichiers locaux, Navidrome/Jellyfin…) et d'avoir une bibliothèque
unifiée, des playlists synchronisées entre services, des paroles synchronisées et une vraie
expérience client. Inspiration : Liner (tryliner/desktop) et l'app communautaire YouTube Music —
on veut faire mieux, sans dépendre d'un catalogue/backend privé.

## Contraintes (décidées)
- **Serverless** : aucun backend à nous. Tout vit chez l'utilisateur (tokens, bibliothèque SQLite locale).
- **Chaque utilisateur connecte ses propres comptes**. Spotify : OAuth PKCE (pas de secret client).
  YouTube : OAuth loopback (installed app). Option « apporte ta clé » (assistant guidé) car les quotas
  sont liés à l'identifiant d'application (Spotify dev mode limité en nb d'utilisateurs, YouTube ~10k unités/jour).
- **Architecture à plugins** : une interface `Connector` (auth, lire playlists, chercher, résoudre un morceau,
  écrire une playlist). Un modèle de morceau commun : titre, artiste, album, durée, ISRC, ids par source.
- **Dédoublonnage/matching par ISRC**, repli par titre+artiste+durée.
- **Lecture audio légale uniquement** : lecteurs officiels (Spotify Web Playback SDK, lecteur YouTube embarqué),
  fichiers locaux, serveurs perso. PAS d'extraction/contournement d'audio.
- `ytmusicapi` (non officielle) = connecteur optionnel isolé, jamais la fondation.
- Paroles : LRCLIB (gratuit), rendu synchronisé fait maison.
- **Ne pas copier le code de Liner** : sa licence est source-available non commerciale et interdit forks
  concurrents/réutilisation d'algorithmes. Tout est écrit de zéro. Les idées (UX, concept) sont libres.

## Pile
Electron, React 19, TypeScript, Vite, Zustand, Tailwind, SQLite (better-sqlite3), Vitest. pnpm.
Appels réseau depuis le processus principal Electron (pas de CORS). Tokens chiffrés (safeStorage).

## Mission de cette session
1. Lis ce fichier, propose une structure de dépôt et un `CLAUDE.md` court (conventions, commandes).
2. Initialise le projet (git, pnpm, Electron + Vite + React + TS, lint, Vitest).
3. Implémente le cœur : modèle de morceau, interface `Connector`, base SQLite, tests du matching ISRC.
4. Premier connecteur : Spotify (PKCE, lecture des playlists). Valide-le sur un vrai compte avant d'aller plus loin.
5. Deuxième connecteur : YouTube (import d'une playlist + matching vers Spotify).
6. Écran minimal : connexion des comptes, liste de la bibliothèque unifiée, bouton de sync.
Livre par petits commits. Ne passe à l'étape suivante que si la précédente est testée.
Vérifie les quotas/règles actuels des API avant de les figer (ils changent).

## Hors périmètre pour l'instant
Visuels WebGL, lecteur complet, mobile, backend de sync en arrière-plan, monétisation.

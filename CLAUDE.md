# Music App

App desktop (Electron + React + TS) qui unifie les bibliothèques Spotify / YouTube / local. Brief : `PROMPT.md`.

## Règles non négociables
- Serverless : aucun backend à nous. Tokens chiffrés (safeStorage) et bibliothèque SQLite chez l'utilisateur.
- Lecture audio légale uniquement (Spotify Web Playback SDK, lecteur YouTube embarqué, fichiers locaux, serveurs perso). Aucune extraction d'audio.
- Ne jamais copier de code de Liner (licence non commerciale, réutilisation interdite). Tout est écrit de zéro.
- Chaque utilisateur apporte son propre client ID (Spotify : mode dev = propriétaire Premium, 5 utilisateurs max).

## Structure
- `src/core/` : TypeScript pur, sans Electron. Modèle `Track`, interface `Connector`, matching, bibliothèque SQLite (`node:sqlite`), OAuth loopback.
- `src/connectors/` : un fichier par service, implémente `Connector`. `fetch` injectable pour les tests.
- `src/main/` : processus principal Electron. Tous les appels réseau partent d'ici (pas de CORS). IPC.
- `src/preload/` : pont `window.api`.
- `src/renderer/` : React + Zustand + Tailwind. Ne parle qu'à `window.api`.

## Commandes
- `pnpm dev` : lance l'app
- `pnpm test` : Vitest (`src/**/*.test.ts`)
- `pnpm typecheck` / `pnpm lint`
- `pnpm build`

## Conventions
- Tests à côté du code (`foo.test.ts`). Pas de réseau réel dans les tests : fausse `fetch`.
- Petits commits, une étape testée à la fois.
- Vérifier les quotas et endpoints des API avant de les figer (ils changent ; Spotify a renommé `/tracks` en `/items` en février 2026).

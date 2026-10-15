# Music App

App desktop (Tauri 2 + Rust + React/TS) qui unifie les bibliothèques Spotify / YouTube / local. Brief : `PROMPT.md`.
Maquette de référence : fichier Figma « Untitled », page « Music App » (écrans Library et Sources).

## Règles non négociables
- Serverless : aucun backend à nous. Secrets dans le trousseau de l'OS (crate `keyring`), bibliothèque SQLite locale.
- Lecture audio légale uniquement (Spotify Connect / SDK officiel, lecteur YouTube embarqué, fichiers locaux, serveurs perso). Aucune extraction d'audio.
- Ne jamais copier de code de Liner (licence non commerciale, réutilisation interdite). Tout est écrit de zéro.
- Chaque utilisateur apporte son propre client ID (Spotify : mode dev = propriétaire Premium, 5 utilisateurs max).

## Structure
- `crates/core` (`music-core`) : Rust pur, sans Tauri. `Track`, trait `Connector`, `SecretStore`, matching (ISRC puis titre+artiste+durée), `Library` (rusqlite), `sync`.
- `crates/connectors` (`music-connectors`) : OAuth PKCE loopback partagé + un module par service. URLs injectables (`with_urls`) pour les tests mockito.
- `crates/player` (`music-player`) : lecture locale native (rodio/symphonia), thread moteur, file gapless. Choix de lecture (YouTube, local, plan Spotify) : `docs/playback.md`.
- `src-tauri` : shell fin. Commandes IPC (`lib.rs`), trousseau (`secrets.rs`). Toute la logique va dans `crates/`.
- `ui/` : React 19 + Zustand + Tailwind v4, découpé par fonctionnalité :
  - `app/` (shell, store, navigation), `features/<nom>/` (library, sources, sidebar…), `shared/` (api typée, format, composants `ui/`).
  - `shared/api.ts` = seul point d'appel à `invoke`. Types recopiés à la main depuis Rust : les garder synchronisés.
- Jetons de design : `ui/src/styles.css` (`@theme`), repris de la maquette Figma.

## Commandes
- `pnpm dev` : lance l'app (Vite + Tauri)
- `pnpm check` : typecheck + lint + Vitest + clippy + cargo test (tout doit passer avant un commit)
- `pnpm test` / `cargo test --workspace` séparément
- `pnpm build` : installeur

## Conventions
- Commentaires de code : en anglais, style caveman (fragments courts, pas d'articles ni de remplissage). Ex. `// Feb 2026: own playlists only.`
- Tests Rust dans le module (`#[cfg(test)]`), tests front à côté du code (`*.test.ts`). Jamais de réseau réel dans les tests.
- Pas de faux boutons : une fonctionnalité non branchée est absente ou marquée « Bientôt ».
- Listes longues : virtualisées (`@tanstack/react-virtual`). Pas d'accès réseau depuis le front : tout passe par Rust.
- Petits commits, une étape testée à la fois.
- Vérifier les quotas et endpoints des API avant de les figer (ils changent ; Spotify a renommé `/tracks` en `/items` en février 2026).

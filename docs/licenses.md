# Third-party licenses

Audit of everything the app bundles, done 2026-10-17. Music App's own license is in [LICENSE](../LICENSE); section 6
there says third-party components keep their own licenses.

## Checks

```bash
pnpm check:licenses
```

It runs `scripts/licenses.mjs` (the interface's production packages) and `cargo deny check licenses bans sources`
(every Rust crate on every platform, rules in [deny.toml](../deny.toml)). CI runs both. Install cargo-deny once with
`cargo install --locked cargo-deny`.

A dependency with a license that isn't allowed fails the check. Read its license, add a line to the table below, then
add it to the allow list in `deny.toml` **and** to `accepted` in [about.toml](../about.toml) (the notices, below): the
check fails if the two lists differ.

## Result

645 Rust crates (every platform, build tools included) and 16 interface packages. **No GPL, LGPL or AGPL code**
(`r-efi` offers LGPL-2.1 only as an alternative to MIT / Apache-2.0).

| License | What uses it | What it asks of us |
|---|---|---|
| MIT, Apache-2.0, BSD-2/3-Clause, ISC, Zlib, 0BSD, Unlicense, MIT-0 | Almost every Rust crate (Tauri, tokio, reqwest, rusqlite…), React, Zustand, TanStack Virtual, Phosphor icons, Tauri JS API | Ship their copyright and license text with the app. Apache-2.0: also any `NOTICE` file. Done: the notices file, below. |
| Unicode-3.0 | ICU crates (`icu_*`, `zerovec`, `yoke`…) under `url` / `idna` | Same as MIT: ship the notice. |
| MPL-2.0 | `symphonia` (local playback, through `rodio`), `adblock` (Brave's engine), `cssparser` / `selectors` / `dtoa-short` (Tauri's HTML tooling), `option-ext` (through `dirs`). `colored` too, at build time only | File-level copyleft. Unmodified use is fine in a closed app. We must tell users where the source of those files is (the notices file, below). If we ever change one of their files, that file must be published under MPL-2.0. |
| CDLA-Permissive-2.0 | `webpki-root-certs` (root certificate data) | Ship the license text. |
| OFL-1.1 | Fonts: Roboto, Geist Mono, Schibsted Grotesk (`@fontsource-variable/*`). Noto Emoji's waving flags (language picker, `ui/src/shared/flags`, 72 px PNG made from its `region-flags/waved-svg`; flag art public domain), license file next to them | The license must travel with the fonts. Free to bundle; never sell the fonts on their own. |
| CC0-1.0 | `simple-icons` (Spotify, YouTube, Apple Music logos) | Nothing for the icons. The logos are still trademarks: README says so. |

### Not bundled, so nothing to ship

- **EasyList / EasyPrivacy** (GPL-3.0 or CC BY-SA 3.0): the ad shield downloads them at runtime from easylist.to
  (`crates/shield`). The app only ships its own fallback rules.
- **System libraries**: WebView2 (Windows), WebKitGTK, OpenSSL, D-Bus, ALSA (Linux), WebKit and Security.framework
  (macOS). Linked from the OS, not copied into the installer. The Windows installer may download Microsoft's WebView2
  bootstrapper, under Microsoft's own terms.
- **Services** (YouTube Music, Spotify, Apple's catalog, Discord): reached at runtime under each user's own account and
  terms. No code or data from them is bundled.

## Notices in the installer

Done 2026-10-17 (it was the to-do before the first release). The installer carries `third-party-licenses.html`, which
the MIT, BSD, Apache-2.0, Unicode, OFL and MPL rows above all need. Settings › About › Third-party licenses opens it in
the default browser (`open_licenses` in `src-tauri/src/lib.rs`).

What's in it: every component in a table (version, license, authors, link to its source), the full license texts with
their copyright lines (one copy of each identical text), `NOTICE` files, and a section with the source links of the
MPL-2.0 crates (`symphonia*`, `adblock`, `cssparser`, `selectors`, `dtoa-short`, `option-ext`).

- `scripts/notices.mjs` (`pnpm notices`) writes it to `src-tauri/third-party-licenses.html` (git-ignored, about 500 KB).
  Rust side: [cargo-about](https://github.com/EmbarkStudios/cargo-about) on the app's crates for this machine's target
  (rules in [about.toml](../about.toml): dev dependencies left out, a crate's choice of licenses resolved to the one with
  fewest duties). Interface side: the `LICENSE` files of the production packages and the three fonts in `node_modules`.
- `src-tauri/tauri.conf.json` › `bundle.resources` puts it in the installer.
- `.github/workflows/release.yml` generates it before `tauri-action`, so each release matches its `Cargo.lock` and
  `pnpm-lock.yaml`.
- `src-tauri/build.rs`: a release build stops if the file is missing; a dev build writes a placeholder page instead,
  so `pnpm dev`, `pnpm check` and CI don't need cargo-about.

To build it locally (an installer, or to read it):

```bash
cargo install --locked cargo-about --features cli
pnpm notices
```

`pnpm build` runs `pnpm notices` first; a bare `pnpm tauri build` uses the file already there. If cargo-about reports a
crate whose license it can't read, check that crate's license by hand and add a `[<crate>.clarify]` entry to
`about.toml`.

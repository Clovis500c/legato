# Packaging

Prepared here, submitted by the owner only (an outward step, on their GitHub account).

## winget

`winget/Clovis500c.Legato/<version>/`: the three manifests for a Stable release, checked with
`winget validate --manifest packaging/winget/Clovis500c.Legato/1.1.681` (passes). Not tried: `winget install --manifest`,
which would install over the app on this PC.

- First submission: a pull request to `microsoft/winget-pkgs` adding the folder as
  `manifests/c/Clovis500c/Legato/<version>/`, or `wingetcreate submit packaging/winget/Clovis500c.Legato/<version>`.
- Later Stable releases, once the first is merged: `wingetcreate update Clovis500c.Legato --version <v> --urls
  https://github.com/Clovis500c/legato/releases/download/v<v>/Legato_<v>_x64-setup.exe --submit`.
- The installer's SHA-256 is the release asset's digest:
  `gh api repos/Clovis500c/legato/releases/latest --jq '.assets[] | .name + " " + .digest'`.
- `AppsAndFeaturesEntries` match what the NSIS installer writes (HKCU uninstall key `Legato`, publisher `legato`): winget
  then sees the app's own updates between two songs as the same package.

## Scoop

None, decided alone (2026-11-07). Scoop wants a portable app it updates itself; Legato installs per user through its
NSIS installer and updates itself through it, so a Scoop copy would leave a second install behind on its first update
(and act as the installed app: Run entry, folders). Comes back if a portable build with its updater off exists.

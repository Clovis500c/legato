# Privacy and playback

What leaves your PC, and when. Short version in the [README](../README.md).

- **No server, no account of ours.** Your library is a local SQLite database; tokens stay in the Windows Credential
  Manager.
- **Sync Mode (off until you set it up).** Each PC writes one file in a folder you pick (OneDrive by default): your
  library, history and settings, sealed with your password if you choose one (then your Spotify app ID and Music
  Detector token travel too); without a password, OneDrive can read them and you sign in again on each PC. Over your
  network, a 6-digit code seals the exchange. Details: [sync-mode.md](sync-mode.md).
- **Official playback only.** Music plays through each service's own player or from your files. Nothing is downloaded
  or extracted. Sound features (Adaptive Sound, the Live Editor, the visualizer) process what plays as it plays, in
  memory: nothing is recorded or saved (the Live Editor keeps its settings, never sound; only your own files can be
  exported), and Settings › Playback can keep YouTube's sound untouched. Details: [playback.md](playback.md).
- **One gateway to the network.** All requests go through the Rust core; the interface never calls the network itself.
- **Voice search (off until you allow it).** The mic uses Windows' own online speech recognition: while it listens,
  your voice goes to Microsoft's speech service through Windows. The app keeps nothing.
- **Lyrics.** Opening lyrics in Now Playing asks YouTube Music first when you're signed in (its timed lyrics, the
  video's id), then sends the song's title, artist, album and length to [LRCLIB](https://lrclib.net) (free, open lyrics
  database). Answers are kept on your PC; timings you fix by hand travel with Sync Mode.
- **Music Detector (off until you allow it).** "Identify a song" listens for 10 seconds to the microphone, or to what
  this PC plays (asked separately; Music App pauses its own music meanwhile), keeps the sound in memory and sends it
  once to [AudD](https://audd.io) to name the song: a few a day with no account, more with your own AudD token. Nothing
  is saved; a token stays in the Windows Credential Manager.
- **Embedding check.** When a YouTube song starts, its video id (and the next two) is sent to YouTube's oEmbed to
  learn whether its owner turned embedding off; the answer is kept for a day.

## Connecting services

| Service | How it connects |
|---|---|
| YouTube Music | Sign in with Google, on Google's own page. Several accounts supported. |
| Spotify | Your own app from the Spotify Developer Dashboard (Premium needed in development mode), or paste public playlist links. |
| Apple Music | Catalog search and 30-second previews, no account needed. |
| Local files | Add your music folders. |

Building the installer (`pnpm build`) needs cargo-about for its license notices: see [licenses.md](licenses.md).

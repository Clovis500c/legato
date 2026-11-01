import { msg, tr } from './i18n/i18n'

/** What went wrong, in words a listener can act on; detail = the raw message (Rust's error chain) for a closer look. */
export interface Explained {
  text: string
  detail?: string
}

// Network failures as Rust (reqwest, Windows sockets) and the webview word them. "Too Many Requests" is HTTP's own
// casing: the explanation below says it in lowercase, so explaining twice changes nothing.
const KINDS: [RegExp, string][] = [
  [/dns error|no such host|error trying to connect|tcp connect error|network is unreachable|os error (10050|10051|10065|11001|11004)|failed to fetch/i, msg('No internet connection: check your network, then try again.')],
  [/timed out|deadline has elapsed|os error 10060/i, msg('The service took too long to answer: try again in a moment.')],
  [/\b429\b|Too Many Requests|→ 403 Forbidden[^]*Sorry/, msg('Too many requests for now: wait a few minutes, then try again.')],
  [/→ 5\d\d\b|\b50[0234] (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i, msg('The service is having trouble right now: try again later.')],
  // Pasted Deezer / Apple Music links (crates/connectors deezer.rs, itunes.rs): said by Rust in English, shown in the user's language.
  [/^This playlist is private or doesn't exist/, msg("This playlist is private or doesn't exist")],
  // Spotify's public embed (spotify_embed.rs) can't see a private list: what works instead.
  [/^This Spotify playlist is private or doesn't exist/, msg("This Spotify playlist is private or doesn't exist: private playlists and Liked Songs come in with Add music › Connect Spotify")],
  [/^This Spotify album is private or doesn't exist/, msg("This Spotify album was removed, or isn't available in your country")],
  [/^This album was removed, or isn't available in its store/, msg("This album was removed, or isn't available in its store")],
  [/^That link is a single song: paste a playlist or album link/, msg('That link is a single song: paste a playlist or album link')],
  [/^This playlist has no songs/, msg('This playlist has no songs')],
  [/^This Deezer link doesn't lead to a playlist or an album/, msg("This Deezer link doesn't lead to a playlist or an album")],
  [/^Deezer is busy right now/, msg('Deezer is busy right now: try again in a minute')],
  // Add music › Connect Spotify › Open Spotify's data export (crates/core spotify_export.rs).
  [/^No Spotify lists in that file/, msg("No Spotify lists in that file: it should come from Exportify or Spotify's data export")],
  // Spotify's copied song links (src-tauri spotify_paste.rs).
  [/^No Spotify song links in that text/, msg('No Spotify song links in that text')],
  [/^Spotify's pages didn't answer/, msg("Spotify's pages didn't answer: try again later")],
  // Pasted SoundCloud song links (crates/connectors soundcloud.rs, src-tauri links.rs song_link).
  [/^SoundCloud shares a playlist's songs only with registered apps/, msg("SoundCloud shares a playlist's songs only with registered apps: paste one song's link at a time")],
  [/^This SoundCloud link doesn't lead to a song/, msg("This SoundCloud link doesn't lead to a song")],
  [/^This SoundCloud link doesn't exist/, msg("This SoundCloud link doesn't exist")],
  [/^This SoundCloud song is private or doesn't exist/, msg("This SoundCloud song is private or doesn't exist")],
  [/^This song wasn't found on YouTube/, msg("This song wasn't found on YouTube: nothing to play it from")],
  // Settings › General › Restore a backup (crates/core library.rs).
  [/^Not a Legato library backup/, msg('Not a Legato library backup')],
  [/^This library was made by a newer version of Legato/, msg('This backup was made by a newer version of Legato: update the app first')],
  // Add music › From iTunes or MusicBee (src-tauri libfile.rs).
  [/^Not a library file: pick iTunes Music Library\.xml/, msg('Not a library file: pick iTunes Music Library.xml (from iTunes, or the copy MusicBee writes for other apps)')],
  [/^No playlists in that library file/, msg('No playlists in that library file')],
  // Connect Spotify with the account set to Off (src-tauri lib.rs).
  [/^Spotify: sync direction is Off/, msg('Sync direction is Off: nothing comes in (Settings › Accounts)')],
  [/^Apple changed its page/, msg('Apple changed its page: paste the songs as text instead (Add music › Import a list of songs)')],
]

/** A service named first, as Rust prefixes its errors ("YouTube Music: …"): it stays in front of the explanation. */
const SERVICE = /^(YouTube Music|YouTube|Apple Music|Spotify|Last\.fm|LRCLIB|AudD|Discord)\b/

/** The text of an error, without the "Error: " JavaScript puts in front of a thrown string. */
export const rawOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error: /, '').trim()

/** A raw error, or the same text when it's already in plain words (most of the app's own errors are). */
export function explain(error: unknown): Explained {
  const raw = rawOf(error)
  const kind = KINDS.find(([re]) => re.test(raw))
  if (!kind) return { text: raw }
  const service = SERVICE.exec(raw)?.[1]
  return { text: service ? `${service}: ${tr(kind[1])}` : tr(kind[1]), detail: raw }
}

/** A known failure in plain English, service first ("Spotify: No internet connection…"); undefined for any other text. Never
 * translated: the diagnostics log is read by whoever fixes the bug, whatever the interface's language. */
export function plainKind(error: unknown): string | undefined {
  const raw = rawOf(error)
  const kind = KINDS.find(([re]) => re.test(raw))
  if (!kind) return undefined
  const service = SERVICE.exec(raw)?.[1]
  return service ? `${service}: ${kind[1]}` : kind[1]
}

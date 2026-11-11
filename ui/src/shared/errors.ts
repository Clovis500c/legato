import { msg, tr } from './i18n/i18n'

/** What went wrong, in words a listener can act on; detail = the raw message (Rust's error chain) for a closer look. */
export interface Explained {
  text: string
  detail?: string
}

// Network failures as Rust (reqwest, Windows sockets) and the webview word them. "Too Many Requests" is HTTP's own
// casing: the explanation below says it in lowercase, so explaining twice changes nothing.
const KINDS: [RegExp, string][] = [
  // Your music server (connectors subsonic.rs, player http.rs, src-tauri servers.rs): before the generic network ones,
  // their own words say which server and what to do.
  [/^Your music server refused the sign-in/, msg('Your music server refused the sign-in: check the user and the password')],
  [/^Your music server doesn['’]t answer/, msg('Your music server doesn’t answer: check that it’s on and that its address is right')],
  [/^Your music server['’]s certificate isn['’]t trusted/, msg('Your music server’s certificate isn’t trusted (a self-signed one?): use its http:// address on your network, or give it a certificate from a known authority')],
  [/^Your music server is too old for Legato/, msg('Your music server is too old for Legato: it needs the Subsonic API 1.13 or newer')],
  [/^That address isn['’]t a Subsonic server/, msg('That address isn’t a Subsonic server: check it (Navidrome’s is like http://192.168.1.10:4533)')],
  [/^Your music server (cut the connection|stopped sending|sent no audio)/, msg('Your music server stopped sending this song: check your network, then play it again')],
  [/^Your music server no longer has this song|^Your music server doesn['’]t have this item/, msg('Your music server no longer has this song: sync it again in Settings › Accounts')],
  [/^Your music server isn['’]t signed in/, msg('Your music server isn’t signed in: sign in again in Settings › Accounts')],
  [/^Your music server no longer accepts this sign-in/, msg('Your music server no longer accepts this sign-in: sign in again in Settings › Accounts')],
  [/^Your music server is too old for Legato: it needs Jellyfin/, msg('Your music server is too old for Legato: it needs Jellyfin 10.9 or newer')],
  [/^That address isn['’]t a Jellyfin server/, msg('That address isn’t a Jellyfin server: check it (Jellyfin’s is like http://192.168.1.10:8096)')],
  [/^That address isn['’]t a Plex server/, msg('That address isn’t a Plex server')],
  [/^Your music server sent a format Legato can['’]t play/, msg('Your music server sent a format Legato can’t play')],
  [/^Your music server speaks a newer API/, msg('Your music server speaks a newer API than Legato knows')],
  [/^Your music server doesn['’]t let this user do that/, msg('Your music server doesn’t let this user do that')],
  [/^Your music server only takes the password sent as it is/, msg('Your music server only takes the password sent as it is: use its https:// address, then confirm')],
  [/^Your music server doesn['’]t take this kind of sign-in/, msg('Your music server doesn’t take this kind of sign-in for this user')],
  // Sign in with Plex (connectors plex.rs, src-tauri plex.rs).
  [/^Plex['’]s sign-in doesn['’]t answer/, msg('Plex’s sign-in doesn’t answer: check your internet connection, then try again')],
  [/^Plex refused the sign-in/, msg('Plex refused the sign-in: sign in with Plex again')],
  [/^Plex is busy right now/, msg('Plex is busy right now: try again in a minute')],
  [/^Plex['’]s sign-in failed/, msg('Plex’s sign-in failed: try again later')],
  [/^Plex['’]s sign-in code expired/, msg('Plex’s sign-in code expired: sign in with Plex again')],
  [/^Your Plex account has no server/, msg('Your Plex account has no server: set one up in Plex, then sign in again')],
  [/^Your music server failed/, msg('The service is having trouble right now: try again later.')],
  [/^Type your server['’]s address/, msg('Type your server’s address, like http://192.168.1.10:4533')],
  [/^Your server['’]s address starts with/, msg('Your server’s address starts with http:// or https://')],
  [/^Type your server['’]s user and password/, msg('Type your server’s user and password')],
  [/^Music server: sync direction is Off/, msg('Sync direction is Off: nothing comes in (Settings › Accounts)')],
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
  // Settings › Accounts › ListenBrainz (src-tauri listenbrainz.rs).
  [/^A ListenBrainz token is the long code/, msg('A ListenBrainz token is the long code under Settings › User token on listenbrainz.org')],
  [/^ListenBrainz does not know this token/, msg('ListenBrainz does not know this token: copy it again from listenbrainz.org › Settings')],
  [/^ListenBrainz refused your token/, msg('ListenBrainz refused your token: paste it again in Settings › Accounts')],
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

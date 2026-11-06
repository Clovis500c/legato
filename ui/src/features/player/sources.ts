import type { Track } from '../../shared/api'
import { msg } from '../../shared/i18n/i18n'

/** How a track plays here. server = your music server, by the native engine like a local file. spotify = Spotify Connect
 * (user's own app, Premium). preview = Apple 30 s clip. */
export type Via = 'local' | 'server' | 'youtube' | 'spotify' | 'preview'

export const viaLabel: Record<Via, string> = { local: msg('Local file'), server: msg('Your music server'), youtube: 'YouTube', spotify: 'Spotify Connect', preview: msg('Apple Music preview') }

/** Ways this track can play, best first: local file, your server, YouTube (in app), Spotify (when connected), then preview. */
export const vias = (t: Pick<Track, 'ids'>, spotify = false): Via[] => [t.ids.local && 'local', t.ids.server && 'server', t.ids.youtube && 'youtube', spotify && t.ids.spotify && 'spotify', t.ids.apple && 'preview'].filter((v): v is Via => !!v)

/** Plays in full (not just a preview). */
export const isFull = (t: Pick<Track, 'ids'>, spotify = false) => !!(t.ids.local || t.ids.server || t.ids.youtube || (spotify && t.ids.spotify))

/** Engine paths of server songs (`music_player::http::PREFIX`): no URL, no auth, Rust builds the requests. */
export const SERVER_PATH = 'server:'

/** Played by the native engine: a local file or a server song. */
export const isNative = (via: Via | undefined) => via === 'local' || via === 'server'

/** What the native engine plays for `via`: the file, or the server song's engine path. */
export const nativePath = (t: Pick<Track, 'ids'>, via: Via): string | undefined => (via === 'local' ? t.ids.local : via === 'server' && t.ids.server ? SERVER_PATH + t.ids.server : undefined)

/** A status path's way in. */
export const viaOfPath = (path: string): Via => (path.startsWith(SERVER_PATH) ? 'server' : 'local')

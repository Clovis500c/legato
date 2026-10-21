import type { Track } from '../../shared/api'
import { msg } from '../../shared/i18n/i18n'

/** How a track plays here. spotify = Spotify Connect (user's own app, Premium). preview = Apple 30 s clip. */
export type Via = 'local' | 'youtube' | 'spotify' | 'preview'

export const viaLabel: Record<Via, string> = { local: msg('Local file'), youtube: 'YouTube', spotify: 'Spotify Connect', preview: msg('Apple Music preview') }

/** Ways this track can play, best first: local file, YouTube (in app), Spotify (when connected), then preview. */
export const vias = (t: Pick<Track, 'ids'>, spotify = false): Via[] => [t.ids.local && 'local', t.ids.youtube && 'youtube', spotify && t.ids.spotify && 'spotify', t.ids.apple && 'preview'].filter((v): v is Via => !!v)

/** Plays in full (not just a preview). */
export const isFull = (t: Pick<Track, 'ids'>, spotify = false) => !!(t.ids.local || t.ids.youtube || (spotify && t.ids.spotify))

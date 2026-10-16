import type { Track } from '../../shared/api'

/** How a track plays here. preview = Apple 30 s clip (Spotify needs Premium: not here yet). */
export type Via = 'local' | 'youtube' | 'preview'

export const viaLabel: Record<Via, string> = { local: 'Local file', youtube: 'YouTube', preview: 'Apple Music preview' }

/** Ways this track can play, best first: local file, full YouTube, then preview. */
export const vias = (t: Pick<Track, 'ids'>): Via[] => [t.ids.local && 'local', t.ids.youtube && 'youtube', t.ids.apple && 'preview'].filter((v): v is Via => !!v)

/** Plays in full (not just a preview). */
export const isFull = (t: Pick<Track, 'ids'>) => !!(t.ids.local || t.ids.youtube)

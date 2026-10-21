import { msg, tr } from '../../shared/i18n/i18n'
/** Add-ons: extra features, all off until turned on. Built in for now; author + verified kept for later ones. */
export interface Author {
  name: string
  /** Checked by the app's developer. */
  verified: boolean
}

export interface Addon {
  id: string
  name: string
  description: string
  tags: string[]
  author: Author
  /** Has a settings panel (cog); else an info panel. */
  settings: boolean
}

export const DEVELOPER: Author = { name: msg('Developer'), verified: true }

export const DISCORD = 'discord-presence'

export const ADDONS: Addon[] = [
  {
    id: DISCORD,
    name: 'Discord Rich Presence',
    description: msg('Shows what you listen to on your Discord profile: song, artist, cover, time left and a button to the song.'),
    tags: [msg('Social'), msg('Player')],
    author: DEVELOPER,
    settings: true,
  },
]

export type Show = 'all' | 'enabled' | 'disabled'

/** Search in name, description and tags; every picked tag must match. */
export function filterAddons(list: Addon[], { query = '', show = 'all', tags = [], on = {} }: { query?: string; show?: Show; tags?: string[]; on?: Record<string, boolean> }): Addon[] {
  const q = query.trim().toLowerCase()
  return list.filter(
    (a) =>
      (show === 'all' || (show === 'enabled') === (on[a.id] === true)) &&
      tags.every((t) => a.tags.includes(t)) &&
      // English and the interface's language both match.
      (!q || `${a.name} ${a.description} ${a.tags.join(' ')} ${tr(a.description)} ${a.tags.map((t) => tr(t)).join(' ')}`.toLowerCase().includes(q)),
  )
}

export const allTags = (list: Addon[]) => [...new Set(list.flatMap((a) => a.tags))].sort()

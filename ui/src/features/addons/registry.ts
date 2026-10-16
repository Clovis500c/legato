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

export const DEVELOPER: Author = { name: 'Developer', verified: true }

export const DISCORD = 'discord-presence'

export const ADDONS: Addon[] = [
  {
    id: DISCORD,
    name: 'Discord Rich Presence',
    description: 'Shows what you listen to on your Discord profile: song, artist, cover, time left and a button to the song.',
    tags: ['Social', 'Player'],
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
      (!q || `${a.name} ${a.description} ${a.tags.join(' ')}`.toLowerCase().includes(q)),
  )
}

export const allTags = (list: Addon[]) => [...new Set(list.flatMap((a) => a.tags))].sort()

/**
 * Right-click menus shaped by the user's choice (plan-v2 › Right-click menus, structure 1): a preset (Essentials,
 * Standard, Full detail), then per kind of menu the items hidden and their order. Pure: no `window`, imported by tests.
 *
 * An item takes part once its builder gives it an `id` from `MENU_ITEMS` (features/menus.tsx). An item without one, or with an
 * id this table doesn't know (a plugin's, an old one), stays where it is, as Standard. Shaping never drops an item the
 * user didn't hide: what the preset leaves out goes under "More…". The menu itself scrolls past the screen's height
 * (ContextMenu: `max-h-[80vh]`, the phone's sheet `75vh`); `MAX_INLINE` keeps a long one short anyway.
 */

export type MenuKind = 'track' | 'tracks' | 'playlist' | 'folder' | 'album' | 'artist' | 'queue' | 'player' | 'nav' | 'app'
export type Level = 'essential' | 'standard' | 'detail'
export type MenuPreset = 'essentials' | 'standard' | 'full'

export const MENU_PRESETS: MenuPreset[] = ['essentials', 'standard', 'full']

/** One item a menu can show. `label`: English, for the customising screen; `group`: items kept together when sorted. */
export interface ItemDef {
  id: string
  label: string
  group: string
  level: Level
}

export interface MenuLayout {
  preset: MenuPreset
  /** Per kind: the ids the user took out. */
  hidden: Partial<Record<MenuKind, string[]>>
  /** Per kind: the ids in the user's order (the others after, as built). */
  order: Partial<Record<MenuKind, string[]>>
}

export const DEFAULT_MENU_LAYOUT: MenuLayout = { preset: 'standard', hidden: {}, order: {} }

/** Inline items at most (separators not counted); the rest goes under "More…". */
export const MAX_INLINE = 16

const def = (id: string, label: string, group: string, level: Level): ItemDef => ({ id, label, group, level })

/** Every item of every menu, by kind. Ids are stable: saved in the settings, never renamed (drop one, never reuse it). */
export const MENU_ITEMS: Record<MenuKind, ItemDef[]> = {
  track: [
    def('play', 'Play', 'play', 'essential'),
    def('playNext', 'Play next', 'play', 'standard'),
    def('addToQueue', 'Add to queue', 'play', 'essential'),
    def('removeFromQueue', 'Remove from queue', 'play', 'essential'),
    def('playVia', 'Play with', 'play', 'detail'),
    def('startRadio', 'Start radio', 'play', 'standard'),
    def('addTo', 'Add to playlist', 'library', 'essential'),
    def('removeFromPlaylist', 'Remove from this playlist', 'library', 'essential'),
    def('removeFrom', 'Remove from library', 'library', 'essential'),
    def('goToAlbum', 'Go to album', 'go', 'essential'),
    def('goToArtist', 'Go to artist', 'go', 'essential'),
    def('findFull', 'Find full version', 'go', 'detail'),
    def('rate', 'Rating', 'taste', 'essential'),
    def('mixes', 'Mixes', 'taste', 'detail'),
    def('explicit', 'Not explicit', 'taste', 'detail'),
    def('music', 'Music or not', 'taste', 'detail'),
    def('copyLink', 'Copy link', 'share', 'standard'),
    def('copyTitle', 'Copy title and artist', 'share', 'standard'),
    def('saveCover', 'Save cover', 'share', 'detail'),
    def('openIn', 'Open in a service', 'share', 'standard'),
    def('credits', 'Credits', 'info', 'detail'),
    def('editInfo', 'Edit song info', 'info', 'standard'),
    def('showInFolder', 'Show in folder', 'info', 'standard'),
    def('thisList', 'This list', 'list', 'standard'),
  ],
  // To fill (Sonnet, from menus.tsx): one def per item of each builder, then `shaped(kind, …)` around it.
  tracks: [],
  playlist: [],
  folder: [],
  album: [],
  artist: [],
  queue: [],
  player: [],
  nav: [],
  app: [],
}

const SHOWN: Record<MenuPreset, ReadonlySet<Level>> = {
  essentials: new Set(['essential']),
  standard: new Set(['essential', 'standard']),
  full: new Set(['essential', 'standard', 'detail']),
}

interface Shapeable {
  id?: string
}
type Entry<T> = T | '-'

/** Separators only between items: none first, last or twice. */
function tidy<T>(list: Entry<T>[]): Entry<T>[] {
  return list.filter((e, i, all) => e !== '-' || (i > 0 && i < all.length - 1 && all[i - 1] !== '-'))
}

/**
 * The menu as the layout wants it. `entries`: a builder's list (falsy entries are dropped, as ContextMenu does);
 * `more`: makes the "More…" submenu from the items set aside. A menu never comes out empty when it went in with items.
 */
export function shapeMenu<T extends Shapeable>(kind: MenuKind, entries: (Entry<T> | false | '' | 0 | null | undefined)[], layout: MenuLayout, more: (items: Entry<T>[]) => T): Entry<T>[] {
  const all = entries.filter((e): e is Entry<T> => !!e)
  const defs = new Map((MENU_ITEMS[kind] ?? []).map((d) => [d.id, d]))
  const hidden = new Set(layout.hidden[kind] ?? [])
  const shown = SHOWN[layout.preset] ?? SHOWN.standard
  let inline: Entry<T>[] = []
  const aside: T[] = []
  for (const e of all) {
    if (e === '-') inline.push(e)
    else if (e.id && hidden.has(e.id)) continue
    else if (shown.has(e.id ? (defs.get(e.id)?.level ?? 'standard') : 'standard')) inline.push(e)
    else aside.push(e)
  }
  const order = layout.order[kind]
  if (order?.length) {
    const rank = (e: T) => {
      const i = e.id ? order.indexOf(e.id) : -1
      return i < 0 ? order.length : i
    }
    // A user's order: the separators go, the items keep the builder's order among equals (a stable sort).
    inline = (inline.filter((e) => e !== '-') as T[]).map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e)
  }
  inline = tidy(inline)
  let count = 0
  const cut = inline.findIndex((e) => e !== '-' && ++count > MAX_INLINE)
  if (cut >= 0) {
    aside.unshift(...(inline.slice(cut).filter((e) => e !== '-') as T[]))
    inline = tidy(inline.slice(0, cut))
  }
  if (aside.length) inline = tidy([...inline, '-', more(aside)])
  return inline.some((e) => e !== '-') || !all.some((e) => e !== '-') ? inline : all
}

/** A saved layout read back: anything else than what it should be is the default's (a settings file can hold anything). */
export function readLayout(v: unknown): MenuLayout {
  if (!v || typeof v !== 'object') return DEFAULT_MENU_LAYOUT
  const r = v as Record<string, unknown>
  const lists = (x: unknown): Partial<Record<MenuKind, string[]>> => {
    if (!x || typeof x !== 'object') return {}
    const out: Partial<Record<MenuKind, string[]>> = {}
    for (const [k, ids] of Object.entries(x as Record<string, unknown>))
      if (k in MENU_ITEMS && Array.isArray(ids)) out[k as MenuKind] = ids.filter((i): i is string => typeof i === 'string' && i.length > 0 && i.length <= 40).slice(0, 100)
    return out
  }
  return { preset: MENU_PRESETS.includes(r.preset as MenuPreset) ? (r.preset as MenuPreset) : DEFAULT_MENU_LAYOUT.preset, hidden: lists(r.hidden), order: lists(r.order) }
}

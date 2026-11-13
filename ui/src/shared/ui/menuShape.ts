/**
 * Right-click menus shaped by the user's choice (plan-v2 › Right-click menus, structure 1): a preset (Essentials,
 * Standard, Full detail), then per kind of menu the items hidden and their order. Pure: no `window`, imported by tests.
 *
 * An item takes part once its builder gives it an `id` from `MENU_ITEMS` (features/menus.tsx). An item without one, or with an
 * id this table doesn't know (a plugin's, an old one), stays where it is, as Standard. Shaping never drops an item the
 * user didn't hide: what the preset leaves out goes under "More…". The menu itself scrolls past the screen's height
 * (ContextMenu: `max-h-[80vh]`, the phone's sheet `75vh`); `MAX_INLINE` keeps a long one short anyway.
 */

import { msg } from '../i18n/i18n'

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
    def('removeFrom', msg('Remove from library'), 'library', 'essential'),
    def('goToAlbum', 'Go to album', 'go', 'essential'),
    def('goToArtist', 'Go to artist', 'go', 'essential'),
    def('findFull', 'Find full version', 'go', 'detail'),
    def('rate', 'Rating', 'taste', 'essential'),
    def('mixes', 'Mixes', 'taste', 'detail'),
    def('explicit', 'Not explicit', 'taste', 'detail'),
    def('music', 'Not music: hide it', 'taste', 'detail'),
    def('copyLink', 'Copy link', 'share', 'standard'),
    def('copyTitle', 'Copy title and artist', 'share', 'standard'),
    def('saveCover', 'Save cover', 'share', 'detail'),
    def('openIn', msg('Open in a service'), 'share', 'standard'),
    def('credits', 'Credits', 'info', 'detail'),
    def('editInfo', 'Edit song info', 'info', 'standard'),
    def('showInFolder', 'Show in folder', 'info', 'standard'),
    def('thisList', 'This list', 'list', 'standard'),
  ],
  // Album and artist pages build no menu of their own: their right-click is the songs' (`tracks`), with Go to artist added.
  album: [],
  artist: [],
  tracks: [
    def('play', 'Play', 'play', 'essential'),
    def('shuffle', 'Shuffle play', 'play', 'standard'),
    def('playNext', 'Play next', 'play', 'standard'),
    def('addToQueue', 'Add to queue', 'play', 'essential'),
    def('startRadio', 'Start radio', 'play', 'standard'),
    def('autoDj', 'Auto-DJ', 'play', 'detail'),
    def('addTo', 'Add to playlist', 'library', 'essential'),
    def('removeFromPlaylist', 'Remove from this playlist', 'library', 'essential'),
    def('editAll', 'Edit song info', 'info', 'standard'),
    def('goToAlbum', 'Go to album', 'go', 'essential'),
    def('goToArtist', 'Go to artist', 'go', 'essential'),
    def('findDuplicates', 'Find duplicates', 'tools', 'detail'),
    def('copyList', 'Copy song list', 'tools', 'detail'),
  ],
  playlist: [
    def('play', 'Play', 'play', 'essential'),
    def('shuffle', 'Shuffle play', 'play', 'standard'),
    def('playNext', 'Play next', 'play', 'standard'),
    def('addToQueue', 'Add to queue', 'play', 'essential'),
    def('startRadio', 'Start radio', 'play', 'standard'),
    def('autoDj', 'Auto-DJ', 'play', 'detail'),
    def('open', 'Open', 'go', 'essential'),
    def('pin', 'Pin to top', 'organise', 'standard'),
    def('moveToFolder', 'Move to folder', 'organise', 'standard'),
    def('findDuplicates', 'Find duplicates', 'tools', 'detail'),
    def('removeRepeated', 'Remove repeated songs', 'tools', 'detail'),
    def('copyList', 'Copy song list', 'tools', 'detail'),
    def('saveFile', 'Save as file…', 'share', 'detail'),
    def('sendTo', msg('Send to a server'), 'share', 'detail'),
    def('copyName', 'Copy name', 'share', 'detail'),
    def('rename', 'Rename', 'edit', 'standard'),
    def('duplicate', 'Duplicate', 'edit', 'standard'),
    def('cover', 'Cover', 'edit', 'standard'),
    def('share', 'Share', 'share', 'standard'),
    def('exportYtm', 'Export to YouTube Music', 'share', 'detail'),
    def('dateOrder', 'Date added order', 'edit', 'detail'),
    def('copyLink', 'Copy link', 'share', 'detail'),
    def('openYtm', 'Open in YouTube Music', 'share', 'detail'),
    def('hide', 'Hide playlist', 'organise', 'standard'),
    def('delete', 'Delete', 'edit', 'essential'),
  ],
  folder: [
    def('play', 'Play', 'play', 'essential'),
    def('shuffle', 'Shuffle play', 'play', 'standard'),
    def('startRadio', 'Start radio', 'play', 'standard'),
    def('autoDj', 'Auto-DJ', 'play', 'detail'),
    def('rename', 'Rename', 'edit', 'standard'),
    def('delete', 'Delete folder', 'edit', 'essential'),
  ],
  queue: [
    def('saveQueue', 'Save the queue as a playlist', 'queue', 'standard'),
    def('shuffle', 'Shuffle', 'queue', 'essential'),
    def('removeRepeats', 'Remove repeated songs', 'queue', 'detail'),
    def('clearNext', 'Clear what’s next', 'queue', 'essential'),
    def('copyList', 'Copy song list', 'queue', 'detail'),
    def('hideUpNext', 'Hide up next', 'queue', 'standard'),
  ],
  player: [
    def('playPause', msg('Play or pause'), 'play', 'essential'),
    def('previous', 'Previous', 'play', 'essential'),
    def('next', 'Next', 'play', 'essential'),
    def('shuffle', 'Shuffle', 'play', 'standard'),
    def('repeat', 'Repeat', 'play', 'standard'),
    def('fullScreen', 'Full screen', 'view', 'standard'),
    def('karaoke', 'Karaoke', 'view', 'detail'),
    def('coverDisplay', 'Cover display', 'view', 'detail'),
    def('pip', 'Picture-in-picture', 'view', 'detail'),
    def('sharePicture', 'Share as a picture', 'share', 'detail'),
    def('room', 'Listen together', 'share', 'detail'),
    def('liveEditor', 'Live Editor', 'sound', 'standard'),
    def('shareMix', 'Share this mix as a file…', 'share', 'detail'),
    def('copyMixLink', 'Copy this mix’s link', 'share', 'detail'),
    def('chapters', 'Chapters', 'play', 'standard'),
    def('cast', 'Cast to speakers', 'sound', 'detail'),
    def('focus', 'Focus session…', 'tools', 'detail'),
    def('workout', 'Workout session…', 'tools', 'detail'),
    def('sleepTimer', 'Sleep timer', 'tools', 'standard'),
    def('alarm', 'Alarm', 'tools', 'detail'),
    def('miniPlayer', 'Mini player', 'view', 'standard'),
    def('playVia', 'Play with', 'play', 'detail'),
    def('addTo', 'Add to playlist', 'library', 'essential'),
    def('removeFromPlaylist', msg('Remove from the playing playlist'), 'library', 'essential'),
    def('rate', 'Rating', 'library', 'essential'),
    def('bookmarks', 'Bookmarks', 'tools', 'detail'),
    def('abLoop', 'A–B loop', 'tools', 'detail'),
    def('output', 'Output device', 'sound', 'standard'),
    def('deviceEq', 'Equalizer for this output', 'sound', 'detail'),
    def('practiceSpeed', 'Practice speed', 'tools', 'detail'),
    def('countIn', 'Count in, then play', 'tools', 'detail'),
    def('metronome', 'Metronome', 'tools', 'detail'),
    def('goToAlbum', 'Go to album', 'go', 'essential'),
    def('goToArtist', 'Go to artist', 'go', 'essential'),
    def('saveCover', 'Save cover', 'share', 'detail'),
    def('addToLibrary', 'Add to library', 'library', 'essential'),
    def('copyVideoUrl', 'Copy video URL', 'share', 'detail'),
    def('copyVideoUrlAt', 'Copy video URL at current time', 'share', 'detail'),
    def('openYoutube', 'Open on YouTube', 'share', 'standard'),
    def('listenApple', 'Listen on Apple Music', 'share', 'standard'),
    def('showInFolder', 'Show in folder', 'share', 'standard'),
  ],
  nav: [
    def('open', 'Open', 'go', 'essential'),
    def('goTo', 'Go to', 'go', 'essential'),
    def('counts', 'Counts in the sidebar', 'view', 'detail'),
    def('hide', 'Hide from the sidebar', 'view', 'standard'),
  ],
  app: [
    def('back', 'Back', 'go', 'essential'),
    def('forward', 'Forward', 'go', 'essential'),
    def('sync', 'Sync library', 'library', 'standard'),
    def('tvHome', 'TV home', 'go', 'detail'),
    def('podcasts', 'Podcasts', 'go', 'standard'),
    def('audiobooks', 'Audiobooks', 'go', 'standard'),
    def('blindTest', 'Blind test', 'go', 'detail'),
    def('addMusic', 'Add music', 'library', 'essential'),
    def('newPlaylist', 'New playlist', 'library', 'essential'),
    def('nowPlaying', 'Now playing', 'go', 'essential'),
    def('room', 'Listen together', 'go', 'detail'),
    def('settings', 'Settings', 'go', 'essential'),
  ],
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

/** The items of a kind as the customising screen lists them: the user's order first, the others as built. */
export function orderedDefs(kind: MenuKind, layout: MenuLayout): ItemDef[] {
  const defs = MENU_ITEMS[kind] ?? []
  const order = layout.order[kind] ?? []
  const first = order.flatMap((id) => defs.filter((d) => d.id === id))
  return [...first, ...defs.filter((d) => !order.includes(d.id))]
}

const without = <K extends string, V>(m: Partial<Record<K, V>>, k: K): Partial<Record<K, V>> => {
  const rest = { ...m }
  delete rest[k]
  return rest
}

/** Takes an item out of a kind's menu, or puts it back. */
export function toggleItem(layout: MenuLayout, kind: MenuKind, id: string): MenuLayout {
  const now = layout.hidden[kind] ?? []
  const next = now.includes(id) ? now.filter((i) => i !== id) : [...now, id]
  return { ...layout, hidden: next.length ? { ...layout.hidden, [kind]: next } : without(layout.hidden, kind) }
}

/** An item one place up (-1) or down (1) in the user's order; at an end it stays. */
export function moveItem(layout: MenuLayout, kind: MenuKind, id: string, by: -1 | 1): MenuLayout {
  const ids = orderedDefs(kind, layout).map((d) => d.id)
  const at = ids.indexOf(id)
  const to = at + by
  if (at < 0 || to < 0 || to >= ids.length) return layout
  ;[ids[at], ids[to]] = [ids[to], ids[at]]
  return { ...layout, order: { ...layout.order, [kind]: ids } }
}

/** One kind back to the preset's own (nothing hidden, the built order); the other kinds are left alone. */
export function resetKind(layout: MenuLayout, kind: MenuKind): MenuLayout {
  return { ...layout, hidden: without(layout.hidden, kind), order: without(layout.order, kind) }
}

/** Does the preset put this item under More… (it is not hidden, only folded)? */
export const foldedBy = (preset: MenuPreset, d: ItemDef): boolean => !SHOWN[preset].has(d.level)

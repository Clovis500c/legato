import { create } from 'zustand'
import type { LibraryPlaylist, LibraryTrack } from '../../shared/api'
import type { View } from '../../app/store'
import { primaryArtist } from '../library/filter'

/** A list page opened lately: Home's Jump back in. This PC only (localStorage), newest first. */
export type OpenedList = { kind: 'playlist'; id: number } | { kind: 'album'; album: string; artist: string } | { kind: 'artist'; artist: string } | { kind: 'mix'; id: string }

const KEY = 'recentLists'
export const MAX_LISTS = 12
/** Lists in Home's shortcut tiles (Songs is the sixth: 3 × 2). */
export const JUMP = 5

export const listKey = (l: OpenedList) => (l.kind === 'playlist' || l.kind === 'mix' ? `${l.kind}:${l.id}` : l.kind === 'album' ? `album:${l.album}\u0000${l.artist}` : `artist:${l.artist}`)

/** The list a page shows, if it's one Jump back in can reopen. */
export function listOf(v: View): OpenedList | null {
  if (v.name === 'playlist') return { kind: 'playlist', id: v.id }
  if (v.name === 'album') return { kind: 'album', album: v.album, artist: v.artist }
  if (v.name === 'artist') return { kind: 'artist', artist: v.artist }
  if (v.name === 'mix') return { kind: 'mix', id: v.id }
  return null
}

/** l on top, once. */
export const pushList = (list: OpenedList[], l: OpenedList) => [l, ...list.filter((x) => listKey(x) !== listKey(l))].slice(0, MAX_LISTS)

// Trust boundary (stored by an older version or edited by hand): known shapes only.
function valid(x: unknown): x is OpenedList {
  const o = x as Record<string, unknown>
  if (!o || typeof o !== 'object') return false
  if (o.kind === 'playlist') return typeof o.id === 'number'
  if (o.kind === 'mix') return typeof o.id === 'string'
  if (o.kind === 'album') return typeof o.album === 'string' && typeof o.artist === 'string'
  return o.kind === 'artist' && typeof o.artist === 'string'
}

function load(): OpenedList[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter(valid).slice(0, MAX_LISTS) : []
  } catch {
    return []
  }
}

export const useOpenedLists = create<{ list: OpenedList[] }>(() => ({ list: load() }))

/** Sidebar order "Opened lately": playlists opened lately first, the rest after in their own order. */
export function byOpened<T extends { id: number }>(playlists: T[], opened: OpenedList[]): T[] {
  const rank = new Map(opened.flatMap((l, i) => (l.kind === 'playlist' ? [[l.id, i] as const] : [])))
  return [...playlists].sort((a, b) => (rank.get(a.id) ?? MAX_LISTS) - (rank.get(b.id) ?? MAX_LISTS))
}

/** A page shown: remembered when it's a list. */
export function noteList(v: View) {
  const l = listOf(v)
  if (!l) return
  const list = pushList(useOpenedLists.getState().list, l)
  useOpenedLists.setState({ list })
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage blocked: remembered until the app closes.
  }
}

/**
 * Jump back in: the lists opened lately that still exist, then (new install, little opened) the albums and artists of
 * the songs played lately, then your playlists, to fill the grid. mixIds = today's mixes (undefined while loading:
 * opened mixes kept).
 */
export function jumpLists(opened: OpenedList[], { tracks, stats, playlists, mixIds }: { tracks: LibraryTrack[]; stats: Record<number, [number, number]>; playlists: LibraryPlaylist[]; mixIds?: string[] }): OpenedList[] {
  const albums = new Set(tracks.flatMap((t) => (t.album ? [`${t.album}\u0000${primaryArtist(t.artist)}`] : [])))
  const artists = new Set(tracks.map((t) => primaryArtist(t.artist)))
  const exists = (l: OpenedList) =>
    l.kind === 'playlist' ? playlists.some((p) => p.id === l.id) : l.kind === 'mix' ? !mixIds || mixIds.includes(l.id) : l.kind === 'album' ? albums.has(`${l.album}\u0000${l.artist}`) : artists.has(l.artist)
  const out: OpenedList[] = []
  const add = (l: OpenedList) => out.length < JUMP && exists(l) && !out.some((x) => listKey(x) === listKey(l)) && out.push(l)
  opened.forEach(add)
  const played = tracks.filter((t) => stats[t.id]?.[1]).sort((a, b) => stats[b.id][1] - stats[a.id][1])
  for (const t of played) {
    if (t.album) add({ kind: 'album', album: t.album, artist: primaryArtist(t.artist) })
    add({ kind: 'artist', artist: primaryArtist(t.artist) })
  }
  ;[...playlists].sort((a, b) => Number(b.custom) - Number(a.custom) || b.trackCount - a.trackCount).forEach((p) => add({ kind: 'playlist', id: p.id }))
  return out
}

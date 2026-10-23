import type { LibraryTrack, Source } from '../../shared/api'
import { fold } from '../../shared/format'
import type { SmartList, SmartRule } from '../../shared/theme/theme'

/** Library play stats: track id → [listens, last start (unix s)]. */
type Stats = Record<number, [number, number]>

const DAY = 86_400

/** Does one song pass one rule? Unknown or unfinished rules (empty value) let everything through. */
export function passes(r: SmartRule, t: LibraryTrack, stats: Stats, newest: Set<number> | null, now: number): boolean {
  const n = Number(r.value)
  switch (r.field) {
    case 'artist':
    case 'album':
    case 'title': {
      const want = fold(r.value.trim())
      if (!want) return true
      const have = fold(t[r.field] ?? '')
      return r.op === 'is' ? have === want : r.op === 'not' ? !have.includes(want) : have.includes(want)
    }
    case 'source': {
      const has = !!t.ids[r.value as Source]
      return r.op === 'not' ? !has : has
    }
    case 'plays': {
      if (r.value.trim() === '' || !Number.isFinite(n)) return true
      const plays = stats[t.id]?.[0] ?? 0
      return r.op === 'atMost' ? plays <= n : plays >= n
    }
    case 'played': {
      if (!(n > 0)) return true
      const last = stats[t.id]?.[1]
      const recent = last !== undefined && last >= now - n * DAY
      return r.op === 'notWithin' ? !recent : recent
    }
    case 'added':
      return !newest || newest.has(t.id)
  }
}

/** Small stable hash: same random order until the rules change. */
const mix = (id: number, salt: string) => {
  let h = 2166136261 ^ id
  for (const c of salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** The songs of a smart playlist, sorted and cut to its limit. */
export function smartTracks(list: SmartList, tracks: LibraryTrack[], stats: Stats, now = Date.now() / 1000): LibraryTrack[] {
  const addedRule = list.rules.find((r) => r.field === 'added' && Number(r.value) > 0)
  const newest = addedRule ? new Set([...tracks].sort((a, b) => b.added - a.added).slice(0, Number(addedRule.value)).map((t) => t.id)) : null
  const test = (t: LibraryTrack) => {
    if (!list.rules.length) return true
    const each = (r: SmartRule) => passes(r, t, stats, newest, now)
    return list.match === 'any' ? list.rules.some(each) : list.rules.every(each)
  }
  const out = tracks.filter(test)
  const plays = (t: LibraryTrack) => stats[t.id]?.[0] ?? 0
  const last = (t: LibraryTrack) => stats[t.id]?.[1] ?? 0
  const salt = JSON.stringify(list.rules) + list.id
  const by: Record<SmartList['sort'], (a: LibraryTrack, b: LibraryTrack) => number> = {
    plays: (a, b) => plays(b) - plays(a) || last(b) - last(a),
    recent: (a, b) => last(b) - last(a),
    added: (a, b) => b.added - a.added,
    title: (a, b) => a.title.localeCompare(b.title),
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    random: (a, b) => mix(a.id, salt) - mix(b.id, salt),
  }
  out.sort(by[list.sort])
  return list.limit ? out.slice(0, list.limit) : out
}

/** A new smart playlist: your most played songs, ready to edit. */
export const newSmartList = (name: string): SmartList => ({ id: `s${Date.now().toString(36)}`, name, match: 'all', rules: [{ field: 'plays', op: 'atLeast', value: '5' }], sort: 'plays', limit: 50 })

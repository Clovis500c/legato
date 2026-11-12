import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'
import type { SmartList, SmartRule } from '../../shared/theme/theme'

/** Words that carry no rule ("some calm jazz songs from the 90s": calm, jazz and 90s do). */
const FILLER = new Set(['a', 'an', 'the', 'some', 'my', 'me', 'songs', 'song', 'music', 'tracks', 'playlist', 'of', 'from', 'and', 'with', 'for', 'to', 'in', 'on', 'only', 'mostly', 'that', 'are', 'is', 'very', 'really', 'just'])
const FAST = new Set(['fast', 'upbeat', 'energetic', 'energy', 'workout', 'running', 'run', 'dance', 'party', 'hype', 'driving'])
const SLOW = new Set(['slow', 'calm', 'chill', 'relaxing', 'relax', 'quiet', 'mellow', 'sleep', 'sleepy', 'soft', 'gentle'])
const NEW = new Set(['new', 'newest', 'recent', 'recently', 'latest', 'fresh'])
const LOVED = new Set(['favorites', 'favourites', 'favorite', 'favourite', 'best', 'top', 'loved'])
const FORGOTTEN = new Set(['forgotten', 'rediscover', 'neglected'])
const NEVER = new Set(['unplayed', 'unheard'])
const DECADES: Record<string, number> = { twenties: 1920, thirties: 1930, forties: 1940, fifties: 1950, sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990, noughties: 2000, aughts: 2000 }

/** "90s", "1990s", "'90s": the decade's first year, else null (two digits from 30 on are the 1900s, below the 2000s). */
function decade(w: string): number | null {
  const m = /^'?(\d{2}|\d{4})'?s$/.exec(w)
  if (!m) return null
  const n = Number(m[1])
  const year = m[1].length === 4 ? n : n >= 30 ? 1900 + n : 2000 + n
  return year % 10 === 0 && year >= 1900 && year <= 2020 ? year : null
}

export type Described = { name: string; rules: SmartRule[]; match: SmartList['match']; sort: SmartList['sort']; heard: string[]; left: string[] }

/**
 * A smart playlist from a few words (the plan's "describe a playlist in words", the local half: no model, no network): decades
 * and years, fast or slow (the tempo tag of local files), new, favorites, forgotten, genres and artists the library has.
 * English words. Null when no word means a rule. `left` = words that meant nothing, for the notice.
 */
export function describePlaylist(text: string, tracks: LibraryTrack[]): Described | null {
  const words = fold(text).split(/[^\p{L}\p{N}']+/u).filter(Boolean)
  const rules: SmartRule[] = []
  const heard: string[] = []
  const left: string[] = []
  let sort: SmartList['sort'] = 'plays'
  const genres = new Map<string, string>()
  const artists = new Map<string, string>()
  for (const t of tracks) {
    if (t.genre) genres.set(fold(t.genre), t.genre)
    if (fold(t.artist).length >= 3) artists.set(fold(t.artist), t.artist)
  }
  const phrase = fold(text)
  // Artists named whole, longest first so "Daft Punk" wins over "Punk"; their words are used up.
  const named = [...artists.keys()].filter((a) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'u').test(phrase)).sort((a, b) => b.length - a.length)
  const used = new Set<string>()
  const picked: string[] = []
  for (const a of named) {
    const parts = a.split(/[^\p{L}\p{N}']+/u).filter(Boolean)
    if (parts.every((p) => used.has(p))) continue
    parts.forEach((p) => used.add(p))
    picked.push(artists.get(a)!)
  }
  if (picked.length) {
    rules.push(...picked.map((a) => ({ field: 'artist' as const, op: 'is', value: a })))
    heard.push(...picked)
  }
  const wanted: string[] = []
  const add = (r: SmartRule, word: string) => {
    if (!rules.some((x) => x.field === r.field && x.op === r.op && x.value === r.value)) rules.push(r)
    heard.push(word)
  }
  for (const w of words) {
    const d = decade(w) ?? DECADES[w] ?? null
    const year = /^(?:19|20)\d{2}$/.test(w) ? Number(w) : null
    if (used.has(w)) continue
    if (d !== null) {
      add({ field: 'year', op: 'atLeast', value: String(d) }, w)
      add({ field: 'year', op: 'atMost', value: String(d + 9) }, w)
    } else if (year !== null) {
      add({ field: 'year', op: 'atLeast', value: String(year) }, w)
      add({ field: 'year', op: 'atMost', value: String(year) }, w)
    } else if (FAST.has(w)) add({ field: 'tempo', op: 'atLeast', value: '120' }, w)
    else if (SLOW.has(w)) add({ field: 'tempo', op: 'atMost', value: '95' }, w)
    else if (NEW.has(w)) {
      add({ field: 'added', op: 'last', value: '50' }, w)
      sort = 'added'
    } else if (LOVED.has(w)) add({ field: 'plays', op: 'atLeast', value: '5' }, w)
    else if (FORGOTTEN.has(w)) {
      add({ field: 'plays', op: 'atLeast', value: '1' }, w)
      add({ field: 'played', op: 'notWithin', value: '180' }, w)
      sort = 'random'
    } else if (NEVER.has(w)) {
      add({ field: 'plays', op: 'atMost', value: '0' }, w)
      sort = 'random'
    } else if (!FILLER.has(w)) wanted.push(w)
  }
  // What is left: a genre of the library, one word or two together ("hip hop"); else it meant nothing.
  const taken = new Set<number>()
  const found: string[] = []
  for (let i = 0; i < wanted.length; i++) {
    for (const span of [2, 1]) {
      const w = wanted.slice(i, i + span).join(' ')
      if (wanted.length - i < span || w.length < 3) continue
      const hit = [...genres.keys()].find((g) => g.includes(w))
      if (hit && !wanted.slice(i, i + span).some((_, k) => taken.has(i + k))) {
        for (let k = 0; k < span; k++) taken.add(i + k)
        found.push(genres.get(hit)!)
        break
      }
    }
  }
  for (const g of found) add({ field: 'genre', op: 'has', value: g }, g)
  wanted.forEach((w, i) => taken.has(i) || left.push(w))
  if (!rules.length) return null
  // Several artists, or several genres, with nothing else to hold: any of them; beside other rules only the first
  // stays (every rule must hold, and two artists never do).
  const only = new Set(rules.map((r) => r.field))
  const match = only.size === 1 && rules.length > 1 && (only.has('artist') || only.has('genre')) ? 'any' : 'all'
  if (match === 'all') for (const f of ['artist', 'genre']) rules.splice(0, rules.length, ...rules.filter((r) => r.field !== f || r === rules.find((x) => x.field === f)))
  return { name: text.trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 60), rules, match, sort, heard, left }
}

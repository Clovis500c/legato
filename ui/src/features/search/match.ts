import type { LibraryTrack } from '../../shared/api'
import { fold } from '../../shared/format'

/**
 * Search form of a name or of what is typed: accents and case folded, apostrophes dropped (don't = dont), & and + read
 * "and", any other mark a space.
 */
export const searchForm = (s: string) =>
  fold(s)
    .replace(/['’ʼ`´]/g, '')
    .replace(/[&+]/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The words typed, in search form. */
export const wordsOf = (q: string) => searchForm(q).split(' ').filter(Boolean)

/** A song's names in search form, each between spaces (a whole word is ` w `, a word's start ` w`). */
interface Form {
  title: string
  artist: string
  album: string
  titleWords: string[]
  artistWords: string[]
  /** The three, then the same without spaces ("acdc" finds AC/DC). */
  hay: string
  tight: string
}

const forms = new WeakMap<LibraryTrack, Form>()

/** Made once per song object: typing stays fast at 50,000 songs. */
export function formOf(t: LibraryTrack): Form {
  let f = forms.get(t)
  if (!f) {
    const [title, artist, album] = [t.title, t.artist, t.album ?? ''].map(searchForm)
    const hay = ` ${title}  ${artist}  ${album} `
    f = { title: ` ${title} `, artist: ` ${artist} `, album: ` ${album} `, titleWords: wordsOf(title), artistWords: wordsOf(artist), hay, tight: hay.replace(/ /g, '') }
    forms.set(t, f)
  }
  return f
}

/** Every word somewhere in the song's names, or in them read without spaces. */
export const hasWords = (f: Form, words: string[]) => words.every((w) => f.hay.includes(w) || f.tight.includes(w))

// A whole word counts most, then a word's start, then inside a word.
const weigh = (field: string, w: string, whole: number) => (field.includes(` ${w} `) ? whole : field.includes(` ${w}`) ? whole * 0.8 : field.includes(w) ? whole * 0.3 : 0)
const covered = (own: string[], words: string[]) => own.length > 0 && own.every((x) => words.includes(x))

/**
 * How well a song fits the words typed (phrase = them joined), higher first: each word in the title counts most, then
 * in the artist, then in the album; the title being the text, or starting with it, more; a title or artist named by
 * nothing but words typed too ("adele hello" puts Hello first).
 */
export function scoreOf(f: Form, words: string[], phrase: string): number {
  let s = 0
  for (const w of words) s += Math.max(weigh(f.title, w, 6), weigh(f.artist, w, 4), weigh(f.album, w, 2), 0.25)
  if (f.title === ` ${phrase} `) s += 20
  else if (f.title.startsWith(` ${phrase}`)) s += 10
  else if (f.title.includes(` ${phrase}`)) s += 5
  if (covered(f.titleWords, words)) s += 12
  if (covered(f.artistWords, words)) s += 6
  return s
}

/** 3: the name is the text, 2: starts with it, 1: one of its words does, 0: holds it elsewhere. */
export const tierOf = (name: string, phrase: string) => (name === phrase ? 3 : name.startsWith(phrase) ? 2 : ` ${name}`.includes(` ${phrase}`) ? 1 : 0)

/** Edit distance (two letters swapped count one), or max + 1 once past max. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let before: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let low = i
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1)
      row[j] = d
      low = Math.min(low, d)
    }
    if (low > max) return max + 1
    before = prev
    prev = row
  }
  return Math.min(prev[b.length], max + 1)
}

const vocabs = new WeakMap<LibraryTrack[], Map<string, number>>()

/** The library's words (3 letters and more) and how many songs use each, once per library. */
function vocabOf(tracks: LibraryTrack[]) {
  let v = vocabs.get(tracks)
  if (!v) {
    v = new Map()
    for (const t of tracks) for (const w of new Set(formOf(t).hay.split(' '))) if (w.length >= 3) v.set(w, (v.get(w) ?? 0) + 1)
    vocabs.set(tracks, v)
  }
  return v
}

/**
 * Typos: each word found in no song swapped for the library's closest word (one letter off, two from 8 letters; its
 * start counts, as the word may be half typed), the most used on a tie. Null when nothing changes or a word has none.
 */
export function correct(tracks: LibraryTrack[], words: string[]): string[] | null {
  let changed = false
  const out: string[] = []
  for (const w of words) {
    const max = w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0
    if (!max || tracks.some((t) => hasWords(formOf(t), [w]))) {
      out.push(w)
      continue
    }
    let best: string | null = null
    let bestD = max + 1
    let bestN = 0
    for (const [v, n] of vocabOf(tracks)) {
      const d = Math.min(distance(w, v, max), v.length > w.length ? distance(w, v.slice(0, w.length), max) : max + 1)
      if (d < bestD || (d === bestD && d <= max && n > bestN)) [best, bestD, bestN] = [v, d, n]
    }
    if (!best) return null
    out.push(best)
    changed = true
  }
  return changed ? out : null
}

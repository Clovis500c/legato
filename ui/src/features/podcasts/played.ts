/** Played marks and "new" episodes of the Podcasts page, kept on this PC (localStorage; a private window just forgets them). */
export type Marks = { played: string[]; seen: Record<string, string[]> }

const KEY = 'legato.podcasts'
const CAP = 5000

export function load(): Marks {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { played: Array.isArray(r.played) ? r.played.filter((x: unknown) => typeof x === 'string') : [], seen: r.seen && typeof r.seen === 'object' ? r.seen : {} }
  } catch {
    return { played: [], seen: {} }
  }
}

export function save(m: Marks) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ played: m.played.slice(-CAP), seen: m.seen }))
  } catch {
    // Not kept: nothing else is lost.
  }
}

/** The mark flipped for one episode (a show's episode id is its guid or audio address, unique enough across shows). */
export const toggle = (m: Marks, id: string): Marks => ({ ...m, played: m.played.includes(id) ? m.played.filter((x) => x !== id) : [...m.played, id] })

/** Episodes not there the last time this show was opened; none the first time (everything would be new). */
export const fresh = (m: Marks, url: string, ids: string[]): string[] => (m.seen[url] ? ids.filter((i) => !m.seen[url].includes(i)) : [])

/** This show's episodes now seen. */
export const seen = (m: Marks, url: string, ids: string[]): Marks => ({ ...m, seen: { ...m.seen, [url]: ids.slice(0, 400) } })

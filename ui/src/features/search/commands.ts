import { fold } from '../../shared/format'

/** Something the search bar opens or does: a page, an action of the shortcuts table, a settings row. */
export interface Command {
  key: string
  kind: 'page' | 'action' | 'setting'
  /** Shown, in the interface's language. */
  label: string
  /** Where it is: "Page", "Settings › Playback"… */
  sub: string
  /** Matched too: the English label, keywords in English and in the interface's language. */
  words: string
  /** Its keys in the app, as keycaps (actions). */
  keys?: string[]
  run: () => void
}

// Scripts written without spaces: a typed word may sit anywhere in a word there.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const split = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Commands where every word typed starts a word of the label or of its words, best first: the label starts with what's
 * typed, then every word found in the label, then in the keywords; shorter labels first within each. One letter
 * matches nothing (every row would).
 */
export function matchCommands<C extends Pick<Command, 'label' | 'words'>>(commands: C[], query: string, max = 4): C[] {
  const q = fold(query).trim().replace(/\s+/g, ' ')
  const typed = q.split(' ').filter(Boolean)
  if (q.length < 2 && !CJK.test(q)) return []
  const found = (words: string[], text: string) => typed.every((w) => words.some((x) => x.startsWith(w)) || (CJK.test(w) && text.includes(w)))
  const ranked: [C, number][] = []
  for (const c of commands) {
    const label = fold(c.label)
    const rank = label.startsWith(q) ? 0 : found(split(c.label), label) ? 1 : found([...split(c.label), ...split(c.words)], `${label} ${fold(c.words)}`) ? 2 : -1
    if (rank >= 0) ranked.push([c, rank])
  }
  return ranked
    .sort((a, b) => a[1] - b[1] || a[0].label.length - b[0].label.length)
    .slice(0, max)
    .map(([c]) => c)
}

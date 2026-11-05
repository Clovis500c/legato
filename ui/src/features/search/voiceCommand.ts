import { fold } from '../../shared/format'
import { msg } from '../../shared/i18n/i18n'

/** What a phrase said into voice search does instead of searching. */
export type VoiceAction = 'next' | 'previous' | 'pause' | 'play' | 'like' | 'louder' | 'quieter'
export type VoiceCommand = { action: VoiceAction } | { action: 'playlist'; id: number }

/**
 * Each command's phrases, `|` between them, said alone. English always works; each language adds its own (the locale
 * files): Windows' speech language may be either.
 */
export const PHRASES: Record<VoiceAction, string> = {
  next: msg('next|skip|next song|skip this song|skip it'),
  previous: msg('previous|previous song|go back|last song'),
  pause: msg('pause|stop|pause the music|stop the music'),
  play: msg('play|resume|play music|keep playing'),
  like: msg('like this|like this song|i like this|i like this song|add to liked music'),
  louder: msg('louder|volume up|turn it up'),
  quieter: msg('quieter|volume down|turn it down'),
}
/** "Play my running playlist": one of these, a playlist's name, and only words of the next list. */
export const PLAY_WORDS = msg('play|put on|start')
export const FILLER_WORDS = msg('my|the|playlist|please')

/** Lower case, no accents, punctuation as spaces. */
const clean = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const list = (s: string) => s.split('|').map(clean).filter(Boolean)
// Chinese and Japanese write no spaces: their words are found anywhere, the others' as whole words.
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const word = (w: string) => new RegExp(NO_SPACES.test(w) ? escape(w) : `(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'gu')

/**
 * A command in what was said, or null: then it's a search. `t`: the interface language's phrases (`tr`). `playlists`:
 * yours; the longest name said wins.
 */
export function voiceCommand(said: string, playlists: readonly { id: number; name: string }[], t: (s: string) => string): VoiceCommand | null {
  const text = clean(said)
  if (!text) return null
  const both = (s: string) => [...new Set([...list(s), ...list(t(s))])].sort((a, b) => b.length - a.length)
  for (const [action, phrases] of Object.entries(PHRASES) as [VoiceAction, string][]) if (both(phrases).includes(text)) return { action }
  const plays = both(PLAY_WORDS)
  const fillers = both(FILLER_WORDS)
  let best: { id: number; length: number } | null = null
  for (const p of playlists) {
    const name = clean(p.name)
    if (name.length < 2 || (best && name.length <= best.length) || !word(name).test(text)) continue
    let rest = text.replace(word(name), ' ')
    let played = false
    for (const w of plays) {
      const next = rest.replace(word(w), ' ')
      played ||= next !== rest
      rest = next
    }
    for (const w of fillers) rest = rest.replace(word(w), ' ')
    if (played && !rest.trim()) best = { id: p.id, length: name.length }
  }
  return best && { action: 'playlist', id: best.id }
}

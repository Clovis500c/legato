import { api } from './api'
import { plainKind, rawOf } from './errors'

/**
 * Local diagnostics log, front end side: errors the interface met and playback switches go to Rust (`diag_log`), which
 * keeps them in a rotating file on this PC. Nothing is sent anywhere. A line has a message (our own words in English: no
 * song titles, account names or paths) and a detail (what an error said), which a copied report shows only when the
 * user ticks "Include details".
 */
export type Level = 'info' | 'warn' | 'error'
export type Send = (level: Level, area: string, message: string, detail?: string) => void

/** The same line is said once a minute; at most 30 lines a minute whatever they say: a failing timer or a render loop can't flood the file. */
const QUIET_MS = 60_000
const PER_MINUTE = 30
const KEYS = 200

/** `send` behind the two limits above. It never throws: the log must not break what it watches. */
export function throttled(send: Send, now: () => number = Date.now): Send {
  const seen = new Map<string, number>()
  let windowAt = 0
  let count = 0
  return (level, area, message, detail) => {
    const t = now()
    const key = `${level}|${area}|${message}|${(detail ?? '').slice(0, 120)}`
    const last = seen.get(key)
    if (last !== undefined && t - last < QUIET_MS) return
    if (t - windowAt >= QUIET_MS) {
      windowAt = t
      count = 0
    }
    if (count >= PER_MINUTE) return
    count++
    // Oldest key out when the table is full.
    seen.delete(key)
    if (seen.size >= KEYS) seen.delete(seen.keys().next().value!)
    seen.set(key, t)
    try {
      send(level, area, message, detail)
    } catch {
      // Nothing to do about a log that can't be written.
    }
  }
}

const toRust: Send = (level, area, message, detail) => void api.diagLog(level, area, message, detail).catch(() => {})

/** One line in the log: `message` in our own words, `detail` whatever the error said. */
export const report = throttled(toRust)

/** A playback switch or another plain event, `message` in English with no title or name: "youtube: the embed refused the video…". */
export const note = (area: string, message: string) => report('info', area, message)

/** An error as message + detail. The message is never the error's own text, which can hold a value or a path: V8 puts
 * them in the engine's errors too ("Cannot create property 'x' on string 'Stairway to Heaven'"). A TypeError and its kin
 * say their name; any other says `fallback` (our words), unless it is a known network failure that errors.ts puts in plain
 * English. What the error said is the detail, which a copied report shows only with "Include details". */
export function describe(error: unknown, fallback: string): { message: string; detail?: string } {
  if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) return { message: error.name, detail: error.message || undefined }
  return { message: plainKind(error) ?? fallback, detail: rawOf(error) || undefined }
}

/** " at index-abc.js:1:2": where an Error was thrown, from its stack's first frame: file name and position, no path. The
 * stack opens with "Name: message", where a value can sit, even a line that looks like a frame: that header is cut off
 * first, and a stack that doesn't open with it (message changed since, other engine) gives no place. */
export function placeOf(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return ''
  const header = error.message ? `${error.name}: ${error.message}` : error.name
  if (!error.stack.startsWith(header)) return ''
  const frame = /^[ \t]*at (?:[^\n]*? \()?([^\s()]+):(\d+):(\d+)\)?[ \t]*$/m.exec(error.stack.slice(header.length))
  const file = frame?.[1].split(/[/\\]/).pop()?.split('?')[0]
  return frame && file ? ` at ${file}:${frame[2]}:${frame[3]}` : ''
}

/** `error` in the log under `area`; `fallback` = what to call it when its own text can't be trusted to be free of names. */
export function reportError(area: string, error: unknown, fallback: string, level: Level = 'warn') {
  const said = describe(error, fallback)
  report(level, area, said.message + placeOf(error), said.detail)
}

/** The first components of React's component stack (" at Sidebar (…)"): where a render error came from. */
export function frames(stack: string | null | undefined, max = 5): string {
  const names = [...(stack ?? '').matchAll(/^\s*at ([\w$.]+)/gm)].map((m) => m[1]).slice(0, max)
  return names.length ? ` in ${names.join(' < ')}` : ''
}

/** The report into the clipboard (details = song titles, account names and paths too). True once it landed. */
export async function copyDiagnostics(details: boolean): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await api.diagReport(details))
    return true
  } catch {
    return false
  }
}

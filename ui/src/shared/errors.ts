import { msg, tr } from './i18n/i18n'

/** What went wrong, in words a listener can act on; detail = the raw message (Rust's error chain) for a closer look. */
export interface Explained {
  text: string
  detail?: string
}

// Network failures as Rust (reqwest, Windows sockets) and the webview word them. "Too Many Requests" is HTTP's own
// casing: the explanation below says it in lowercase, so explaining twice changes nothing.
const KINDS: [RegExp, string][] = [
  [/dns error|no such host|error trying to connect|tcp connect error|network is unreachable|os error (10050|10051|10065|11001|11004)|failed to fetch/i, msg('No internet connection: check your network, then try again.')],
  [/timed out|deadline has elapsed|os error 10060/i, msg('The service took too long to answer: try again in a moment.')],
  [/\b429\b|Too Many Requests/, msg('Too many requests for now: wait a few minutes, then try again.')],
  [/→ 5\d\d\b|\b50[0234] (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i, msg('The service is having trouble right now: try again later.')],
]

/** A service named first, as Rust prefixes its errors ("YouTube Music: …"): it stays in front of the explanation. */
const SERVICE = /^(YouTube Music|YouTube|Apple Music|Spotify|Last\.fm|LRCLIB|AudD|Discord)\b/

/** The text of an error, without the "Error: " JavaScript puts in front of a thrown string. */
export const rawOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error: /, '').trim()

/** A raw error, or the same text when it's already in plain words (most of the app's own errors are). */
export function explain(error: unknown): Explained {
  const raw = rawOf(error)
  const kind = KINDS.find(([re]) => re.test(raw))
  if (!kind) return { text: raw }
  const service = SERVICE.exec(raw)?.[1]
  return { text: service ? `${service}: ${tr(kind[1])}` : tr(kind[1]), detail: raw }
}

/** A known failure in plain English, service first ("Spotify: No internet connection…"); undefined for any other text. Never
 * translated: the diagnostics log is read by whoever fixes the bug, whatever the interface's language. */
export function plainKind(error: unknown): string | undefined {
  const raw = rawOf(error)
  const kind = KINDS.find(([re]) => re.test(raw))
  if (!kind) return undefined
  const service = SERVICE.exec(raw)?.[1]
  return service ? `${service}: ${kind[1]}` : kind[1]
}

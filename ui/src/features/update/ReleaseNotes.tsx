import { msg, tr, trn } from '../../shared/i18n/i18n'
import { parseNotes } from './notes'

// The release script's headers and sentence, said in the user's language; the lines stay as written (English).
const SAID: Record<string, string> = { New: msg('New'), Fixed: msg('Fixed'), Faster: msg('Faster'), 'Small fixes and improvements.': msg('Small fixes and improvements.') }
const say = (s: string) => (SAID[s] ? tr(SAID[s]) : s)

/** "What's new": the notes grouped (New, Fixed, Faster), each line a bullet. */
export function ReleaseNotes({ text }: { text: string }) {
  const { parts, more, other } = parseNotes(text)
  return (
    <span className="mt-1 flex flex-col gap-2">
      {other && <span>{say(other)}</span>}
      {parts.map((p, i) => (
        <span key={i} className="flex flex-col gap-0.5">
          {p.title && <span className="font-semibold text-ink">{say(p.title)}</span>}
          <ul className="list-disc pl-4">
            {p.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        </span>
      ))}
      {more > 0 && <span>{trn(more, 'And {n} more', 'And {n} more')}</span>}
    </span>
  )
}

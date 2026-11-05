/** The share card's picture: 4:5, what feeds and chats show whole. */
export const CARD = { w: 1080, h: 1350, pad: 96 }

/**
 * Text cut into at most `max` lines of `width` (measured by `measure`): by words, by characters where there are no
 * spaces (Chinese, Japanese) or a word is wider than a line; the last line ends with "…" when text is left over.
 */
export function wrapText(text: string, width: number, max: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  // Words keep their space, never cut at a no-break one ("12 AM", "n° 1"); a word too long for a line goes character
  // by character.
  const parts = text.trim().split(/(?<=[^\S\u00a0\u2007\u202f])/).flatMap((w) => (measure(w.trimEnd()) > width ? [...w] : [w]))
  for (let i = 0; i < parts.length; i++) {
    const next = line + parts[i]
    if (!line || measure(next.trimEnd()) <= width) {
      line = next
      continue
    }
    lines.push(line.trimEnd())
    line = parts[i].trimStart()
    if (lines.length === max) return ellipsis(lines, width, measure)
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.length > max ? ellipsis(lines.slice(0, max), width, measure) : lines
}

/** Last line shortened until it fits with "…". */
function ellipsis(lines: string[], width: number, measure: (s: string) => number): string[] {
  let last = lines[lines.length - 1]
  while (last && measure(`${last}…`) > width) last = [...last].slice(0, -1).join('').trimEnd()
  return [...lines.slice(0, -1), `${last}…`]
}

/** The lyric lines one can pick for the card: timed lines or plain text, blank and repeated ones out. */
export function pickableLines(timed: { text: string }[] | undefined, plain: string | undefined): string[] {
  const all = timed?.length ? timed.map((l) => l.text) : (plain ?? '').split('\n')
  return [...new Set(all.map((l) => l.trim()).filter((l) => l && !/^[♪♫\s]+$/.test(l)))]
}

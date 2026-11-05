/** A release's notes as `scripts/notes.mjs` writes them: "### Added" / "### Fixed" / "### Performance improved" over "- "
 *  lines; before 2026-11-05 "### New" / "### Faster" and "And 5 more."; older releases: one flat list, or a sentence. */
export interface Notes {
  parts: { title: string | null; lines: string[] }[]
  more: number
  /** Words that aren't a list ("Small fixes and improvements."). */
  other: string
}

export function parseNotes(text: string): Notes {
  const parts: Notes['parts'] = []
  const other: string[] = []
  let more = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const head = /^#{1,6}\s+(.+)$/.exec(line)
    const rest = /^(?:- )?And (\d+) more\.?$/.exec(line)
    if (head) parts.push({ title: head[1], lines: [] })
    else if (rest) more = Number(rest[1])
    else if (line.startsWith('- ')) {
      if (!parts.length) parts.push({ title: null, lines: [] })
      parts[parts.length - 1].lines.push(line.slice(2))
    } else if (line) other.push(line)
  }
  return { parts: parts.filter((p) => p.lines.length), more, other: other.join(' ') }
}

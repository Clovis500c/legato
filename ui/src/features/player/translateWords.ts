/** The language code MyMemory takes for the interface's language (Chinese wants its region). */
export const translateTarget = (lang: string): string => (lang === 'zh' ? 'zh-CN' : lang)

/** The words to send: each sung line (or each line of plain text) trimmed, empty ones kept so the answer lines up; at most 200 lines. */
export function wordsToTranslate(l: { lines: { text: string }[]; plain: string | null }): string[] {
  const raw = l.lines.length ? l.lines.map((x) => x.text) : (l.plain ?? '').split('\n')
  return raw.slice(0, 200).map((t) => t.trim())
}

/**
 * The translation of each line the panel shows (`shown`: the synced lines with the ♪ breaks it adds), from what was sent
 * (`from`) and what came back (`to`, line for line). Lines are matched by their text walking forward, so a break the panel
 * added, an empty line of the lyrics, or lines past the 200 sent never shift the rest. null = no row under that line (a
 * missing answer, or a line the service gave back as it was).
 */
export function alignTranslation(shown: { text: string }[], from: string[], to: string[]): (string | null)[] {
  let p = 0
  return shown.map(({ text }) => {
    const t = text.trim()
    if (!t) {
      if (p < from.length && !from[p]) p++
      return null
    }
    let q = p
    while (q < from.length && from[q] !== t) q++
    if (q >= from.length) return null
    p = q + 1
    const got = to[q]?.trim()
    return got && got !== t ? got : null
  })
}

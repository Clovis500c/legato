/** The language code MyMemory takes for the interface's language (Chinese wants its region). */
export const translateTarget = (lang: string): string => (lang === 'zh' ? 'zh-CN' : lang)

/** The words to send: each sung line (or each line of plain text) trimmed, empty ones kept so the answer lines up; at most 200 lines. */
export function wordsToTranslate(l: { lines: { text: string }[]; plain: string | null }): string[] {
  const raw = l.lines.length ? l.lines.map((x) => x.text) : (l.plain ?? '').split('\n')
  return raw.slice(0, 200).map((t) => t.trim())
}

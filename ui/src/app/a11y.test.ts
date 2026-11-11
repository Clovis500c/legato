import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Accessibility pass (2026-11-11): what the sources can prove. The interface's own .tsx files, tests aside.
const root = join(__dirname, '..')
const files: string[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name))
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) files.push(join(dir, e.name))
  }
}
walk(root)
const sources = files.map((f) => ({ file: relative(root, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }))
const line = (text: string, at: number) => text.slice(0, at).split('\n').length

/** The opening tag starting at `at`: up to its first `>` outside braces. */
function openTag(s: string, at: number): string {
  let depth = 0
  for (let i = at; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') depth--
    else if (s[i] === '>' && depth === 0) return s.slice(at, i + 1)
  }
  return s.slice(at)
}

/** Does a button's content give it a name: words, a translated text, a value, or a labelled icon? */
function named(body: string): boolean {
  if (/aria-label|<title>/.test(body)) return true
  const text = body.replace(/<[A-Z][\w.]*[^>]*\/>/g, '').replace(/<\/?[A-Z][\w.]*[^>]*>/g, '')
  const expressions = text.replace(/\{[^}]*\}/g, (x) => (/trn?\(|['"`]|^\{\s*[\w.?]+\s*\}$|^\{\s*[\w.]+\s*(&&|\?\?|\|\||\()/.test(x) ? 'x' : ''))
  return /[\p{L}\d]/u.test(expressions)
}

describe('accessibility', () => {
  it('names every button for screen readers (its text, aria-label or title)', () => {
    const unnamed: string[] = []
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/<button\b/g)) {
        const open = openTag(text, m.index)
        if (open.endsWith('/>') || /aria-label|aria-labelledby|title=|\{\.\.\./.test(open)) continue
        const end = text.indexOf('</button>', m.index + open.length)
        if (!named(text.slice(m.index + open.length, end))) unnamed.push(`${file}:${line(text, m.index)}`)
      }
    }
    expect(unnamed).toEqual([])
  })

  it('shows nothing on hover only: a keyboard focus shows it too (display: none leaves it out of Tab)', () => {
    const hoverOnly: string[] = []
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/className=["'`{][^\n]*?\bhidden\b[^\n]*?group-hover:(grid|block|flex|inline-flex)\b/g)) {
        if (!m[0].includes('group-focus-within:')) hoverOnly.push(`${file}:${line(text, m.index)}`)
      }
    }
    expect(hoverOnly).toEqual([])
  })

  it('checks real files', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(named('<Play size={12} />')).toBe(false)
    expect(named('<Play /> {tr(\'Play\')}')).toBe(true)
    expect(named('{on ? <X /> : <Y />}')).toBe(false)
  })
})

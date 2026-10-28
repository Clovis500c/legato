import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { CATALOG, LANGUAGES, loadLang, resolveLang, tr, trn, useLang } from './i18n'

const LOCALES = import.meta.glob<Record<string, string>>('./locales/*.ts', { eager: true, import: 'default' })

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

// A quoted text: '…', "…" or `…` without ${}.
const STR = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|` + '`(?:[^`\\\\$]|\\\\.)*`'
const unquote = (s: string) => s.slice(1, -1).replace(/\\(.)/g, (_, c: string) => ({ n: '\n', t: '\t' })[c] ?? c)

/** Every text the code asks to translate. */
function used(): Set<string> {
  const out = new Set<string>()
  for (const file of sources(ROOT)) {
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(new RegExp(String.raw`\b(?:tr|msg)\(\s*(${STR})`, 'g'))) out.add(unquote(m[1]))
    for (const m of code.matchAll(new RegExp(String.raw`\btrn\([^'"\x60]*?(${STR})\s*,\s*(${STR})`, 'g'))) {
      out.add(unquote(m[1]))
      out.add(unquote(m[2]))
    }
  }
  return out
}

const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe.each(Object.entries(LOCALES))('translations %s', (path, table) => {
  const texts = used()

  it('is a catalogue language', () => {
    expect(CATALOG.map((l) => `./locales/${l.code}.ts`)).toContain(path)
  })

  it('has every text', () => {
    expect([...texts].filter((t) => !(t in table))).toEqual([])
  })

  it('keeps no text gone from the code', () => {
    expect(Object.keys(table).filter((k) => !texts.has(k))).toEqual([])
  })

  it('keeps the same {slots}', () => {
    expect(Object.entries(table).filter(([k, v]) => slots(k).join() !== slots(v).join())).toEqual([])
  })

  it('translates nothing to empty', () => {
    expect(Object.entries(table).filter(([, v]) => !v.trim())).toEqual([])
  })
})

describe('i18n', () => {
  afterEach(() => useLang.setState({ lang: 'en' }))

  it('follows Windows when asked, English otherwise', () => {
    expect(resolveLang('system', ['fr-FR', 'en-US'])).toBe('fr')
    expect(resolveLang('system', ['xx-XX', 'en-GB'])).toBe('en')
    expect(resolveLang('system', ['yy-YY'])).toBe('en')
    expect(resolveLang('fr', ['en-US'])).toBe('fr')
    expect(resolveLang('xx', [])).toBe('en')
    expect(LANGUAGES.map((l) => l.code)).toContain('fr')
  })

  it('fills slots and counts by the language rules', async () => {
    expect(tr('Hello {name}', { name: 'A' })).toBe('Hello A')
    expect(trn(1, '{n} song', '{n} songs')).toBe('1 song')
    expect(trn(0, '{n} song', '{n} songs')).toBe('0 songs')
    expect(trn(1674, '{n} song', '{n} songs')).toBe('1,674 songs')
    await loadLang('fr')
    useLang.setState({ lang: 'fr' })
    expect(tr('Home')).toBe('Accueil')
    // French: 0 and 1 singular; untranslated text falls back to English.
    expect(trn(0, 'zzz {n} one', 'zzz {n} other')).toBe('zzz 0 one')
    expect(trn(1674, 'zzz {n} one', 'zzz {n} other')).toBe('zzz 1 674 other')
  })
})

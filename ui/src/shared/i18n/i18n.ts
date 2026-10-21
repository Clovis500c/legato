import { create } from 'zustand'
import fr from './fr'

/**
 * Interface languages. English is the source: the English text is the key (`tr('Play')`), each other language maps
 * it (`fr.ts`). Adding one = a file like `fr.ts` + a line here. A test checks every `tr` / `trn` / `msg` text has its
 * translation (i18n.test.ts). Pure: no `app/settings` here.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
] as const
export type Lang = (typeof LANGUAGES)[number]['code']

const TABLES: Record<Lang, Record<string, string> | null> = { en: null, fr: french(fr) }

/** French typography: no-break space before : ; ? ! and inside « ». */
function french(table: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.replace(/ ([:;?!»])/g, ' $1').replace(/« /g, '« ')]))
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: 'en' }))
export const lang = () => useLang.getState().lang

/** Setting ('system' or a code) → language: Windows' (the webview's) when supported, else English. */
export function resolveLang(setting: string, system: readonly string[]): Lang {
  const known = (code: string) => LANGUAGES.find((l) => l.code === code.toLowerCase().split('-')[0])?.code
  if (setting !== 'system') return known(setting) ?? 'en'
  for (const s of system) {
    const k = known(s)
    if (k) return k
  }
  return 'en'
}

/** `{name}` → value. */
function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

/** Text in the interface's language. `params` fill `{name}` slots. */
export function tr(text: string, params?: Record<string, string | number>): string {
  return fill(TABLES[lang()]?.[text] ?? text, params)
}

/** Count-dependent text, the language's plural rules: trn(n, '{n} song', '{n} songs'). `{n}` is the formatted count. */
export function trn(n: number, one: string, other: string, params?: Record<string, string | number>): string {
  const l = lang()
  const form = new Intl.PluralRules(l).select(n) === 'one' ? one : other
  return tr(form, { n: n.toLocaleString(l), ...params })
}

/** Marks text in tables and constants, translated where it's shown (`tr(x)`). */
export const msg = <T extends string>(text: T): T => text

/** Locale for Intl formats. */
export const locale = () => (lang() === 'en' ? 'en-US' : lang())

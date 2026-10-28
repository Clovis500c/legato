import { create } from 'zustand'

/**
 * Interface languages. English is the source: the English text is the key (`tr('Play')`), each other language maps
 * it in `locales/<code>.ts`. A language shows in the picker once its file exists. A test checks every file covers every
 * `tr` / `trn` / `msg` text with the same {slots} (i18n.test.ts). Pure: no `app/settings` here.
 */
export const CATALOG = [
  { code: 'en', name: 'English', country: 'GB' },
  { code: 'fr', name: 'Français', country: 'FR' },
  { code: 'es', name: 'Español', country: 'ES' },
  { code: 'de', name: 'Deutsch', country: 'DE' },
  { code: 'it', name: 'Italiano', country: 'IT' },
  { code: 'pt', name: 'Português (Brasil)', country: 'BR' },
  { code: 'nl', name: 'Nederlands', country: 'NL' },
  { code: 'pl', name: 'Polski', country: 'PL' },
  { code: 'sv', name: 'Svenska', country: 'SE' },
  { code: 'tr', name: 'Türkçe', country: 'TR' },
  { code: 'ru', name: 'Русский', country: 'RU' },
  { code: 'uk', name: 'Українська', country: 'UA' },
  { code: 'hi', name: 'हिन्दी', country: 'IN' },
  { code: 'id', name: 'Bahasa Indonesia', country: 'ID' },
  { code: 'vi', name: 'Tiếng Việt', country: 'VN' },
  { code: 'ja', name: '日本語', country: 'JP' },
  { code: 'ko', name: '한국어', country: 'KR' },
  { code: 'zh', name: '中文（简体）', country: 'CN' },
] as const
export type Lang = (typeof CATALOG)[number]['code']

// Each table loads when first needed (~100 kB each): the language in use before the first render (main.tsx), another
// when picked. All up front made 1.6 MB of the 2.4 MB startup script (2026-10-28).
const FILES = import.meta.glob<Record<string, string>>('./locales/*.ts', { import: 'default' })
const file = (code: string) => FILES[`./locales/${code}.ts`]
const TABLES: Partial<Record<Lang, Record<string, string>>> = {}

/** Languages the interface speaks (English + every translated file), in catalogue order. */
export const LANGUAGES = CATALOG.filter((l) => l.code === 'en' || !!file(l.code))

/** Reads `code`'s table, once (English has none). Until it's there, tr() answers in English. */
export async function loadLang(code: Lang): Promise<void> {
  const load = file(code)
  if (TABLES[code] || !load) return
  const table = await load()
  TABLES[code] = code === 'fr' ? french(table) : table
}

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

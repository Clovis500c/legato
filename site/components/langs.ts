/** The app's 18 languages (ui/src/shared/i18n CATALOG), each a page: English at the root, the others under their code. */
export const LANGS: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português (Brasil)' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'sv', name: 'Svenska' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文（简体）' },
]

/** From a page in `from` to the one in `to`: relative, so the base path stays out of it. */
export const pageOf = (from: string, to: string) => (from === 'en' ? '' : '../') + (to === 'en' ? '' : `${to}/`) || './'

/** The site's root from a page in `lang` (its files: shots, demo, licenses). */
export const rootOf = (lang: string) => (lang === 'en' ? '' : '../')

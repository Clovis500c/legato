import { en, type Copy } from './content'
import { de } from './i18n/de'
import { es } from './i18n/es'
import { fr } from './i18n/fr'
import { it } from './i18n/it'
import { pt } from './i18n/pt'

/** Every language's page text (build time only: a page takes its own). */
export const COPIES: Record<string, Copy> = { en, fr, es, de, it, pt }

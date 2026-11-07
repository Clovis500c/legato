import { en, type Copy } from './content'
import { de } from './i18n/de'
import { es } from './i18n/es'
import { fr } from './i18n/fr'
import { id } from './i18n/id'
import { it } from './i18n/it'
import { nl } from './i18n/nl'
import { pl } from './i18n/pl'
import { pt } from './i18n/pt'
import { ru } from './i18n/ru'
import { sv } from './i18n/sv'
import { tr } from './i18n/tr'
import { uk } from './i18n/uk'

/** Every language's page text (build time only: a page takes its own). */
export const COPIES: Record<string, Copy> = { en, fr, es, de, it, pt, nl, pl, sv, tr, ru, uk, id }

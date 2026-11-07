import { en, type Copy } from './content'
import { fr } from './i18n/fr'

/** Every language's page text (build time only: a page takes its own). */
export const COPIES: Record<string, Copy> = { en, fr }

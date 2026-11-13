import type { SettingsSection } from '../../app/store'
import { ACTIONS, comboLabel } from '../../app/keys'
import { msg, tr } from '../../shared/i18n/i18n'
import { categoryOf, SETTINGS } from './catalog'

/**
 * One searchable setting. label = Row / Group title on screen in English (its data-setting id), found and highlighted
 * on open. Label and keywords are matched in English and in the interface's language.
 */
export interface SettingEntry {
  section: SettingsSection
  label: string
  keywords?: string
  /** Matched as is (key names). */
  extra?: string
  /** The group it sat in before (catalog.ts): its old name still finds it. */
  was?: string
}

/** Every setting of the catalog, on its page, then the shortcuts (one entry per action). */
export const SETTINGS_INDEX: SettingEntry[] = [
  ...SETTINGS.map((e): SettingEntry => ({ section: categoryOf(e.id) ?? 'general', label: e.id, keywords: e.keywords, was: e.was })),
  ...ACTIONS.map((a): SettingEntry => ({ section: 'shortcuts', label: a.label, keywords: msg('keyboard shortcut hotkey global background'), extra: a.keys ? comboLabel(a.keys) : undefined })),
]

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Entries where every word typed appears in the label or keywords (English or the interface's language); label matches first. */
export function searchSettings(query: string, index = SETTINGS_INDEX): SettingEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const label = (e: SettingEntry) => fold(`${e.label} ${tr(e.label)}`)
  const hits = index.filter((e) => {
    const text = `${label(e)} ${fold(`${e.keywords ?? ''} ${e.keywords ? tr(e.keywords) : ''} ${e.extra ?? ''} ${e.was ? `${e.was} ${tr(e.was)}` : ''}`)}`
    return words.every((w) => text.includes(w))
  })
  const inLabel = (e: SettingEntry) => words.every((w) => label(e).includes(w))
  return [...hits.filter(inLabel), ...hits.filter((e) => !inLabel(e))]
}

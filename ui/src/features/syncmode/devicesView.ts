import type { DeviceForm, DeviceOs, SyncDeviceRow } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'

const OS_NAMES: Record<DeviceOs, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS' }

/** Spoken kind: "Windows laptop", "Android phone", "iPhone". */
export function kindLabel(os: DeviceOs, form: DeviceForm): string {
  if (os === 'ios') return form === 'tablet' ? 'iPad' : 'iPhone'
  const name = OS_NAMES[os]
  switch (form) {
    case 'tower':
      return tr('{os} tower PC', { os: name })
    case 'laptop':
      return tr('{os} laptop', { os: name })
    case 'desktop':
      return tr('{os} desktop', { os: name })
    case 'phone':
      return tr('{os} phone', { os: name })
    case 'tablet':
      return tr('{os} tablet', { os: name })
  }
}

/** Under a device's name: here or not, its last sync, or what pairing needs. */
export function rowNote(r: SyncDeviceRow, ago: (ms: number) => string): string {
  if (!r.trusted) return r.offering ? tr('Showing a code: pair it') : tr('Not paired')
  if (r.refused) return tr('It forgot this device: pair again')
  const when = r.synced ? ago(r.synced) : null
  if (r.here) return when ? tr('On this network · synced {when}', { when }) : tr('On this network')
  return when ? tr('Not on this network · synced {when}', { when }) : tr('Not on this network')
}

/** Minutes and seconds left: "9:05". */
export function left(until: number, now: number): string {
  const s = Math.max(0, Math.ceil((until - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What the code field holds: 6 digits, or a pasted pairing link. */
export function typedCode(text: string): { code: string; link: string | null } | null {
  const t = text.trim()
  if (t.startsWith('legato://pair?')) return { code: '', link: t }
  const digits = t.replace(/\D/g, '')
  return digits.length === 6 ? { code: digits, link: null } : null
}

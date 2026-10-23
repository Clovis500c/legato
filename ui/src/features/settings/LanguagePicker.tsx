import { CaretDown, Desktop } from '@phosphor-icons/react'
import { BR, CN, DE, ES, FR, GB, ID, IN, IT, JP, KR, NL, PL, RU, SA, SE, TR, UA, VN, type FlagComponent as Flag } from 'country-flag-icons/react/3x2'
import { LANGUAGES, resolveLang, tr, type Lang } from '../../shared/i18n/i18n'
import { openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'

// Drawn flags (country-flag-icons, MIT): Windows draws flag emoji as two letters, Apple's emoji can't ship.
const FLAGS: Record<Lang, Flag> = { en: GB, fr: FR }

/** Languages being translated: listed, marked "Coming soon" (no fake choice). Native names. */
const UPCOMING: { name: string; flag: Flag }[] = [
  { name: 'Español', flag: ES },
  { name: 'Deutsch', flag: DE },
  { name: 'Italiano', flag: IT },
  { name: 'Português (Brasil)', flag: BR },
  { name: 'Nederlands', flag: NL },
  { name: 'Polski', flag: PL },
  { name: 'Svenska', flag: SE },
  { name: 'Türkçe', flag: TR },
  { name: 'Русский', flag: RU },
  { name: 'Українська', flag: UA },
  { name: 'العربية', flag: SA },
  { name: 'हिन्दी', flag: IN },
  { name: 'Bahasa Indonesia', flag: ID },
  { name: 'Tiếng Việt', flag: VN },
  { name: '日本語', flag: JP },
  { name: '한국어', flag: KR },
  { name: '中文', flag: CN },
]

const FlagIcon = ({ flag: F }: { flag: Flag }) => <F aria-hidden className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-[0_0_0_1px_var(--line)]" />

/** Settings › General › Language: dropdown with flags (user's request 2026-10-23), Windows' language first. */
export function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const system = LANGUAGES.find((l) => l.code === resolveLang('system', navigator.languages))!
  const label = (code: string) => (code === 'system' ? tr('Windows ({language})', { language: system.name }) : (LANGUAGES.find((l) => l.code === code)?.name ?? code))
  const items = (): MenuEntry[] => [
    { label: label('system'), icon: <Desktop size={16} />, onSelect: () => onChange('system') },
    '-',
    ...LANGUAGES.map((l) => ({ label: l.name, icon: <FlagIcon flag={FLAGS[l.code]} />, onSelect: () => onChange(l.code) })),
    '-',
    ...UPCOMING.map((l) => ({ label: `${l.name} · ${tr('Coming soon')}`, icon: <FlagIcon flag={l.flag} />, disabled: true })),
  ]
  const current = value === 'system' ? null : FLAGS[value as Lang]
  return (
    <button type="button" aria-haspopup="menu" aria-label={tr('Language')} onClick={(e) => openMenu(e, items(), { place: 'below' })} className="flex h-9 w-fit min-w-64 items-center gap-2.5 rounded-full border border-line bg-raised px-3.5 text-[0.8125rem] font-medium hover:bg-panel">
      {current ? <FlagIcon flag={current} /> : <Desktop size={16} className="text-ink-2" />}
      <span className="flex-1 text-left">{label(value)}</span>
      <CaretDown size={12} weight="bold" className="text-ink-3" />
    </button>
  )
}

import { AndroidLogo, AppleLogo, Desktop, DesktopTower, DeviceMobile, DeviceMobileCamera, DeviceTablet, Laptop, LinuxLogo, WindowsLogo } from '@phosphor-icons/react'
import type { DeviceForm, DeviceOs } from '../../shared/api'

const FORMS = { tower: DesktopTower, laptop: Laptop, desktop: Desktop, phone: DeviceMobile, tablet: DeviceTablet }
const LOGOS = { windows: WindowsLogo, macos: AppleLogo, ios: AppleLogo, android: AndroidLogo, linux: LinuxLogo }

/** A device: its form, its system's logo as a badge, a dot when it's on this network (`here` unset: no dot). */
export function DeviceIcon({ os, form, here, label }: { os: DeviceOs; form: DeviceForm; here?: boolean; label: string }) {
  const Shape = os === 'ios' && form === 'phone' ? DeviceMobileCamera : FORMS[form]
  const Logo = LOGOS[os]
  return (
    <span role="img" aria-label={label} className="relative grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-bg text-ink">
      <Shape size={24} />
      <span className="absolute -end-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full border border-line bg-raised text-ink-2">
        <Logo size={11} weight="fill" />
      </span>
      {here !== undefined && <span className={`absolute -top-1 -end-1 size-3 rounded-full border-2 border-raised ${here ? 'bg-[#23A55A]' : 'bg-line'}`} />}
    </span>
  )
}

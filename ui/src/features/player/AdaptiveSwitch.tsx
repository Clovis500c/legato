import { Megaphone, Prohibit, SpeakerSimpleLow, Waveform } from '@phosphor-icons/react'
import { useSettings } from '../../app/settings'
import { tr } from '../../shared/i18n/i18n'
import { Segmented } from '../../shared/ui/controls'
import { modeOf, patchOf, type Mode } from './adaptiveMode'

const ICONS: Record<Mode, React.ReactNode> = { off: <Prohibit size={13} />, quiet: <SpeakerSimpleLow size={13} />, normal: <Waveform size={13} />, loud: <Megaphone size={13} /> }
const NAMES: Record<Mode, string> = { off: 'Off', quiet: 'Quiet', normal: 'Normal', loud: 'Loud' }

/**
 * Under the volume: Adaptive Sound's mode on the spot, as icon buttons (Off, Quiet, Normal, Loud), the same two stored settings as Settings ›
 * Sound processing, so the two stay in step. Each button's name and tooltip say "Adaptive Sound: <mode>".
 */
export function AdaptiveSwitch({ className = '' }: { className?: string }) {
  const mode = useSettings((s) => modeOf(s.settings))
  const update = useSettings((s) => s.update)
  return (
    <Segmented
      quiet
      label={tr('Adaptive Sound')}
      value={mode}
      onChange={(m) => update(patchOf(m))}
      className={`scale-90 ${className}`}
      options={(Object.keys(ICONS) as Mode[]).map((m) => ({ value: m, label: tr('Adaptive Sound: {why}', { why: tr(NAMES[m]) }), icon: ICONS[m] }))}
    />
  )
}

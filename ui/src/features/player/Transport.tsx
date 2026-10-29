import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from '@phosphor-icons/react'
import { RoundButton } from '../../shared/ui/controls'
import { useShallow } from 'zustand/react/shallow'
import { usePlayer } from './store'
import { msg, tr } from '../../shared/i18n/i18n'

const repeatLabel = { off: msg('Repeat: off'), all: msg('Repeat: whole queue'), one: msg('Repeat: this track') }
const sizes = {
  sm: { skip: 'sm', play: 'md', icon: 13, big: 16, mode: 15 },
  md: { skip: 'md', play: 'md', icon: 20, big: 18, mode: 20 },
  lg: { skip: 'lg', play: 'xl', icon: 18, big: 28, mode: 22 },
} as const

/** Same transport everywhere (bar, Now Playing, mini player), plain icons around the play button. compact = no shuffle / repeat. */
export function Transport({ size = 'md', compact = false }: { size?: 'sm' | 'md' | 'lg'; compact?: boolean }) {
  // Only what it draws: no re-render on every position report.
  const { has, queue, playing, toggle, step, shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayer(
    useShallow((p) => ({ has: !!p.now, queue: !!p.now?.trackId, playing: p.playing, toggle: p.toggle, step: p.step, shuffle: p.shuffle, repeat: p.repeat, toggleShuffle: p.toggleShuffle, cycleRepeat: p.cycleRepeat })),
  )
  const s = sizes[size]
  // On: ink with a dot under it (sky blue stays for the play button, docs/design.md).
  const mode = (on: boolean) => (on ? 'relative text-ink! after:absolute after:bottom-0.5 after:size-1 after:rounded-full after:bg-ink' : '')
  const buttons = [
    !compact && (
      <RoundButton key="shuffle" label={shuffle ? tr('Shuffle: on') : tr('Shuffle: off')} aria-pressed={shuffle} kind="plain" size={s.skip} disabled={!queue} onClick={toggleShuffle} className={mode(shuffle)}>
        <Shuffle size={s.mode} weight={shuffle ? 'bold' : 'regular'} />
      </RoundButton>
    ),
    <RoundButton key="prev" label={tr('Previous')} kind="plain" size={s.skip} disabled={!has} onClick={() => step(-1)}>
      <SkipBack weight="fill" size={s.icon} className="text-ink" />
    </RoundButton>,
    <RoundButton key="play" label={playing ? tr('Pause') : tr('Play')} kind="primary" size={s.play} disabled={!has} onClick={toggle}>
      {playing ? <Pause weight="fill" size={s.big} /> : <Play weight="fill" size={s.big} />}
    </RoundButton>,
    <RoundButton key="next" label={tr('Next')} kind="plain" size={s.skip} disabled={!has} onClick={() => step(1)}>
      <SkipForward weight="fill" size={s.icon} className="text-ink" />
    </RoundButton>,
    !compact && (
      <RoundButton key="repeat" label={tr(repeatLabel[repeat])} aria-pressed={repeat !== 'off'} kind="plain" size={s.skip} disabled={!queue} onClick={cycleRepeat} className={mode(repeat !== 'off')}>
        {repeat === 'one' ? <RepeatOnce size={s.mode} weight="bold" /> : <Repeat size={s.mode} weight={repeat === 'all' ? 'bold' : 'regular'} />}
      </RoundButton>
    ),
  ].filter(Boolean)
  return <div className={`flex items-center ${size === 'lg' ? 'gap-5' : 'gap-3'}`}>{buttons}</div>
}

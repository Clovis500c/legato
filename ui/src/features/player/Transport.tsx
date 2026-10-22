import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from '@phosphor-icons/react'
import { RoundButton } from '../../shared/ui/controls'
import { useShallow } from 'zustand/react/shallow'
import { usePlayer } from './store'
import { msg, tr } from '../../shared/i18n/i18n'

const repeatLabel = { off: msg('Repeat: off'), all: msg('Repeat: whole queue'), one: msg('Repeat: this track') }
const repeatName = { off: msg('Repeat'), all: msg('Repeat all'), one: msg('Repeat one') }
const sizes = {
  sm: { skip: 'sm', play: 'md', icon: 13, big: 16, mode: 15 },
  md: { skip: 'md', play: 'lg', icon: 15, big: 20, mode: 18 },
  lg: { skip: 'lg', play: 'xl', icon: 18, big: 28, mode: 22 },
} as const

/** Same transport everywhere (bar, Now Playing, mini player). compact = no shuffle / repeat. Shuffle and repeat named underneath. */
export function Transport({ size = 'md', compact = false }: { size?: 'sm' | 'md' | 'lg'; compact?: boolean }) {
  // Only what it draws: no re-render on every position report.
  const { has, queue, playing, toggle, step, shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayer(
    useShallow((p) => ({ has: !!p.now, queue: !!p.now?.trackId, playing: p.playing, toggle: p.toggle, step: p.step, shuffle: p.shuffle, repeat: p.repeat, toggleShuffle: p.toggleShuffle, cycleRepeat: p.cycleRepeat })),
  )
  const s = sizes[size]
  // Lit like an amp switch: readable even with a gray system accent.
  const mode = (on: boolean) => (on ? 'relative bg-raised text-ink after:absolute after:bottom-1 after:size-1 after:rounded-full after:bg-accent' : '')
  const name = (on: boolean, text: string) => <span className={`text-[0.625rem] leading-none ${on ? 'text-ink' : 'text-ink-3'} ${queue ? '' : 'opacity-35'}`}>{text}</span>
  const buttons = [
    !compact && (
      <RoundButton key="shuffle" label={shuffle ? tr('Shuffle: on') : tr('Shuffle: off')} aria-pressed={shuffle} kind="plain" size={s.skip} disabled={!queue} onClick={toggleShuffle} className={mode(shuffle)}>
        <Shuffle size={s.mode} weight={shuffle ? 'bold' : 'regular'} />
      </RoundButton>
    ),
    <RoundButton key="prev" label={tr('Previous')} kind={size === 'lg' ? 'soft' : 'ghost'} size={s.skip} disabled={!has} onClick={() => step(-1)}>
      <SkipBack weight="fill" size={s.icon} />
    </RoundButton>,
    <RoundButton key="play" label={playing ? tr('Pause') : tr('Play')} kind="primary" size={s.play} disabled={!has} onClick={toggle}>
      {playing ? <Pause weight="fill" size={s.big} /> : <Play weight="fill" size={s.big} />}
    </RoundButton>,
    <RoundButton key="next" label={tr('Next')} kind={size === 'lg' ? 'soft' : 'ghost'} size={s.skip} disabled={!has} onClick={() => step(1)}>
      <SkipForward weight="fill" size={s.icon} />
    </RoundButton>,
    !compact && (
      <RoundButton key="repeat" label={tr(repeatLabel[repeat])} aria-pressed={repeat !== 'off'} kind="plain" size={s.skip} disabled={!queue} onClick={cycleRepeat} className={mode(repeat !== 'off')}>
        {repeat === 'one' ? <RepeatOnce size={s.mode} weight="bold" /> : <Repeat size={s.mode} weight={repeat === 'all' ? 'bold' : 'regular'} />}
      </RoundButton>
    ),
  ].filter(Boolean)
  if (compact || size === 'sm') return <div className="flex items-center gap-3">{buttons}</div>
  // Two rows: buttons centered on one line, names under shuffle and repeat only.
  return (
    <div className="grid items-center justify-items-center gap-x-3 gap-y-1" style={{ gridTemplateColumns: `repeat(${buttons.length}, auto)` }}>
      {buttons}
      {name(shuffle, tr('Shuffle'))}
      <span />
      <span />
      <span />
      {name(repeat !== 'off', tr(repeatName[repeat]))}
    </div>
  )
}

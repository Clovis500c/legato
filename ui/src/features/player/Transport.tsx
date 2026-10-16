import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from '@phosphor-icons/react'
import { RoundButton } from '../../shared/ui/controls'
import { usePlayer } from './store'

const repeatLabel = { off: 'Repeat: off', all: 'Repeat: whole queue', one: 'Repeat: this track' }
const sizes = {
  sm: { skip: 'sm', play: 'md', icon: 13, big: 16 },
  md: { skip: 'md', play: 'lg', icon: 15, big: 20 },
  lg: { skip: 'lg', play: 'xl', icon: 18, big: 28 },
} as const

/** Same transport everywhere (bar, Now Playing, mini player). compact = no shuffle / repeat. */
export function Transport({ size = 'md', compact = false }: { size?: 'sm' | 'md' | 'lg'; compact?: boolean }) {
  const { now, playing, toggle, step, shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayer()
  const queue = !!now?.trackId
  const s = sizes[size]
  const mode = (on: boolean) => (on ? 'text-accent' : '')
  return (
    <div className="flex items-center gap-3">
      {!compact && (
        <RoundButton label={shuffle ? 'Shuffle: on' : 'Shuffle: off'} aria-pressed={shuffle} kind="plain" size="sm" disabled={!queue} onClick={toggleShuffle} className={mode(shuffle)}>
          <Shuffle size={s.icon} weight={shuffle ? 'bold' : 'regular'} />
        </RoundButton>
      )}
      <RoundButton label="Previous" kind={size === 'lg' ? 'soft' : 'ghost'} size={s.skip} disabled={!now} onClick={() => step(-1)}>
        <SkipBack weight="fill" size={s.icon} />
      </RoundButton>
      <RoundButton label={playing ? 'Pause' : 'Play'} kind="primary" size={s.play} disabled={!now} onClick={toggle}>
        {playing ? <Pause weight="fill" size={s.big} /> : <Play weight="fill" size={s.big} />}
      </RoundButton>
      <RoundButton label="Next" kind={size === 'lg' ? 'soft' : 'ghost'} size={s.skip} disabled={!now} onClick={() => step(1)}>
        <SkipForward weight="fill" size={s.icon} />
      </RoundButton>
      {!compact && (
        <RoundButton label={repeatLabel[repeat]} aria-pressed={repeat !== 'off'} kind="plain" size="sm" disabled={!queue} onClick={cycleRepeat} className={mode(repeat !== 'off')}>
          {repeat === 'one' ? <RepeatOnce size={s.icon} weight="bold" /> : <Repeat size={s.icon} weight={repeat === 'all' ? 'bold' : 'regular'} />}
        </RoundButton>
      )}
    </div>
  )
}

import { tr } from '../../shared/i18n/i18n'
import { usePlayer } from './store'

/** The playing song's bars, in the text's colour: moving while it plays, held when paused (styles.css). */
export function PlayingBars({ className = '' }: { className?: string }) {
  const playing = usePlayer((s) => s.playing)
  return (
    <span aria-hidden data-moving={playing} className={`playing-bars ${className}`}>
      <i />
      <i />
      <i />
    </span>
  )
}

/** The playing song's mark (song lists, album and artist pages, Up next): its bars in an accent square. */
export function PlayingMark() {
  return (
    <span title={tr('Playing')} className="grid size-6 shrink-0 place-items-center rounded-[4px] glow-mark bg-accent text-on-accent">
      <PlayingBars />
    </span>
  )
}

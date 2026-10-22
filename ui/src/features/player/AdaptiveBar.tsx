import { useEffect, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { useLive } from './live'
import { usePlayer } from './store'
import { locale, tr } from '../../shared/i18n/i18n'

/**
 * Under the volume, while Adaptive Sound is on: the volume as Adaptive Sound makes it, live (thin accent line), its
 * gain and the song's loudness in the tooltip. Painted straight into the DOM: levels come 30 times a second.
 */
export function AdaptiveBar({ className = '' }: { className?: string }) {
  const on = useSettings((s) => s.settings.adaptiveSound)
  const youtube = useSettings((s) => s.settings.liveYoutube)
  const via = usePlayer((s) => s.now?.via)
  const error = useLive((s) => s.error)
  const box = useRef<HTMLSpanElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const why =
    via === 'spotify' ? tr('Spotify plays in its own app, out of reach') : via === 'youtube' && !youtube ? tr('off for YouTube (Settings › Advanced)') : via === 'youtube' && error ? error : null
  useEffect(() => {
    if (!on || !via || why) return
    const paint = () => {
      const levels = useLive.getState().levels
      const gain = levels?.gain ?? 0
      const level = Math.min(1, usePlayer.getState().volume * 10 ** (gain / 20))
      fill.current?.style.setProperty('width', `${level * 100}%`)
      const minus = (v: number) => (v < 0 ? '−' : '')
      const song = levels && levels.short > -70 ? ` · ${tr('song at {lufs} LUFS', { lufs: minus(levels.short) + Math.abs(Math.round(levels.short)) })}` : ''
      box.current?.setAttribute('title', `${tr('Adaptive Sound')} ${minus(gain) || '+'}${Math.abs(gain).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dB${song}`)
    }
    paint()
    const offLevels = useLive.subscribe(paint)
    const offVolume = usePlayer.subscribe((s, p) => s.volume !== p.volume && paint())
    return () => {
      offLevels()
      offVolume()
    }
  }, [on, via, why])
  if (!on || !via) return null
  return (
    <span ref={box} title={why ? tr('Adaptive Sound: {why}', { why }) : undefined} className={`block h-0.5 overflow-hidden rounded-full bg-line ${why ? 'opacity-50' : ''} ${className}`}>
      {!why && <span ref={fill} className="block h-full rounded-full bg-accent transition-[width] duration-100" />}
    </span>
  )
}

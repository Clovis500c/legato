import { ArrowsOutSimple } from '@phosphor-icons/react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { trackArt } from '../../shared/art'
import { RoundButton } from '../../shared/ui/controls'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { playerMenu } from '../menus'
import { VideoSlot } from './NowPlaying'
import { usePlayer } from './store'
import { Transport } from './Transport'

/** Floating card above the bar. YouTube: always shown, the video sits in it (min 200 px tall, controls below, never on top). */
export function MiniPlayer() {
  const { now, full, setFull } = usePlayer()
  const on = useSettings((s) => s.settings.miniPlayer)
  const track = useStore((s) => s.tracks.find((t) => t.id === now?.trackId))
  const video = now?.via === 'youtube'
  if (!now || full || !(video || on)) return null
  return (
    <div role="region" aria-label="Mini player" onContextMenu={onMenu(playerMenu)} className="fixed right-6 bottom-[104px] z-20 flex w-89 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_12px_32px_var(--shadow)]">
      {video && <VideoSlot className="h-50 w-full rounded-none" />}
      <div className="flex items-center gap-3 p-3">
        {!video && <Cover title={now.title} art={track && trackArt(track)} size={44} />}
        <button onClick={() => setFull(true)} className="min-w-0 flex-1 text-left" title="Open Now Playing">
          <span className="block truncate text-[13px] font-semibold">{now.title}</span>
          <span className="block truncate text-xs text-ink-2">{now.artist}</span>
        </button>
        <Transport size="sm" compact />
        <RoundButton label="Now playing, full screen" kind="plain" size="sm" onClick={() => setFull(true)}>
          <ArrowsOutSimple size={13} />
        </RoundButton>
      </div>
    </div>
  )
}

import { ArrowsOutSimple } from '@phosphor-icons/react'
import { useSettings } from '../../app/settings'
import { trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { RoundButton } from '../../shared/ui/controls'
import { playerMenu } from '../menus'
import { VideoSlot } from './NowPlaying'
import { useNowTrack, usePlayer } from './store'

/**
 * Mini player docked at the bottom of the sidebar (user's pick 2026-10-22): never over the content. YouTube: the video
 * fills a 200 px tall slot (YouTube's minimum; the 16:9 frame is wider, its sides cut). Other sources: the cover, only
 * when the mini player is on. Click the video: play / pause; the title opens Now Playing.
 */
export function SidebarPlayer() {
  const now = usePlayer((s) => s.now)
  const full = usePlayer((s) => s.full)
  const setFull = usePlayer((s) => s.setFull)
  const toggle = usePlayer((s) => s.toggle)
  const docked = useSettings((s) => s.settings.miniPlace === 'sidebar')
  const on = useSettings((s) => s.settings.miniPlayer)
  const track = useNowTrack()
  const video = now?.via === 'youtube'
  if (!now || full || !docked || !(video || on)) return null
  return (
    <section aria-label={tr('Mini player')} onContextMenu={onMenu(playerMenu)} className="flex shrink-0 flex-col gap-2 border-t border-line-soft px-3 pt-3">
      {video ? (
        <VideoSlot fill onClick={toggle} className="h-50 w-full" />
      ) : (
        <button onClick={() => setFull(true)} title={tr('Open Now Playing')} className="block">
          <Cover title={now.title} art={track && trackArt(track)} size={228} />
        </button>
      )}
      <div className="flex items-center gap-1">
        <button onClick={() => setFull(true)} className="min-w-0 flex-1 text-left" title={tr('Open Now Playing')}>
          <span className="block truncate text-[0.8125rem] font-semibold">{now.title}</span>
          <span className="block truncate text-xs text-ink-2">{now.artist}</span>
        </button>
        <RoundButton label={tr('Now playing, full screen')} kind="plain" size="sm" onClick={() => setFull(true)}>
          <ArrowsOutSimple size={13} />
        </RoundButton>
      </div>
    </section>
  )
}

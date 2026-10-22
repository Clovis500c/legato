import { CaretRight, Waveform } from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../../app/store'
import { trackArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { trackMenu } from '../menus'
import { fileFormat } from './PlayerBar'
import { queueRows, type QueueRow } from './queue'
import { vias } from './sources'
import { fileTitle, useNowTrack, usePlayer } from './store'
import { tr } from '../../shared/i18n/i18n'

const ROW = 60

/** Rows of the queue panel: library queue in play order, or dropped files (current + engine queue). */
function useRows(): QueueRow[] {
  const trackId = usePlayer((s) => s.now?.trackId)
  const list = usePlayer((s) => s.list)
  const order = usePlayer((s) => s.order)
  const index = usePlayer((s) => s.index)
  const upcoming = usePlayer((s) => s.upcoming)
  const path = usePlayer((s) => s.now?.path)
  const sp = useStore((s) => s.status.spotify.connected)
  return useMemo(() => {
    if (trackId !== undefined) return queueRows(order, index, (i) => !!list[i] && vias(list[i], sp).length > 0)
    return [...(path ? [path] : []), ...upcoming].map((p, k) => ({ key: p, i: -1, played: false, current: k === 0 && !!path, path: p }))
  }, [trackId, list, order, index, sp, upcoming, path])
}

/** Songs still to play after the current one (button label when the panel is folded). */
export function useNextCount(): number {
  const rows = useRows()
  return rows.filter((r) => !r.played && !r.current).length
}

/**
 * Queue in play order, shuffle aware: songs already played stay (dimmed, click to play again), then the current one,
 * then what's next. Opens on the current song; virtualized (queues reach thousands).
 */
export function UpNext({ onHide }: { onHide: () => void }) {
  const rows = useRows()
  const list = usePlayer((s) => s.list)
  const playAt = usePlayer((s) => s.playAt)
  const nowTitle = usePlayer((s) => s.now?.title ?? '')
  const nowArtist = usePlayer((s) => s.now?.artist ?? '')
  const track = useNowTrack()
  const scroller = useRef<HTMLOListElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 8 })
  const current = rows.findIndex((r) => r.current)
  const played = current < 0 ? 0 : current
  const next = rows.length - played - (current < 0 ? 0 : 1)
  // New song: bring it to the top, history above it within reach.
  useEffect(() => {
    if (current >= 0) v.scrollToIndex(current, { align: 'start' })
  }, [current, v])

  return (
    <aside className="flex min-h-0 flex-col gap-2 rounded-2xl border border-line-soft bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] p-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[0.8125rem] font-semibold">{tr('Up next')}</span>
        <span className="kicker flex-1">
          {tr('{n} next', { n: next })}
          {played ? ` · ${tr('{n} played', { n: played })}` : ''}
        </span>
        <RoundButton label={tr('Hide up next')} kind="plain" size="sm" onClick={onHide}>
          <CaretRight size={14} />
        </RoundButton>
      </div>
      <ol ref={scroller} className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: v.getTotalSize() }} className="relative">
          {v.getVirtualItems().map((item) => {
            const r = rows[item.index]
            const t = r.i >= 0 ? list[r.i] : undefined
            const title = r.current ? nowTitle : (t?.title ?? fileTitle(r.path ?? ''))
            const artist = r.current ? nowArtist : (t?.artist ?? fileFormat(r.path) ?? '')
            const art = r.current && track ? trackArt(track) : t ? trackArt(t) : []
            return (
              <li key={r.key} className="absolute inset-x-0" style={{ top: item.start, height: ROW }} onContextMenu={t ? onMenu(() => trackMenu(t, { list, index: r.i, queueIndex: r.i })) : undefined}>
                <button
                  disabled={!t || r.current}
                  onClick={() => void playAt(r.i)}
                  className={`flex h-full w-full items-center gap-3 rounded-lg px-2 text-left ${r.current ? 'bg-accent-soft' : 'enabled:hover:bg-raised'} ${r.played ? 'opacity-55 hover:opacity-100' : ''}`}
                >
                  <Cover title={title} art={art} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[0.8125rem] font-semibold ${r.current ? 'text-accent' : ''}`}>{title}</span>
                    <span className="block truncate text-xs text-ink-2">{artist}</span>
                  </span>
                  {r.current ? <Waveform size={14} className="shrink-0 text-accent" /> : t && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{formatDuration(t.durationMs)}</span>}
                </button>
              </li>
            )
          })}
        </div>
        {next === 0 && <li className="py-6 text-center text-ink-3">{tr('Nothing after this track.')}</li>}
      </ol>
    </aside>
  )
}

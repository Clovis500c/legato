import { useVirtualizer } from '@tanstack/react-virtual'
import { Clock3, Play } from 'lucide-react'
import { useRef } from 'react'
import type { LibraryTrack, Source } from '../../shared/api'
import { usePlayer } from '../player/store'
import { coverGradient, formatDuration } from '../../shared/format'
import { SourceIcon } from '../../shared/ui/SourceIcon'

const ROW = 56
const cols = 'grid grid-cols-[24px_minmax(0,1fr)_minmax(0,220px)_96px_48px] items-center gap-4 px-3'
const order: Source[] = ['spotify', 'youtube', 'local']

/** Virtualized: only visible rows hit the DOM, so 50k tracks stay smooth. */
export function TrackTable({ tracks, empty }: { tracks: LibraryTrack[]; empty: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const play = usePlayer((s) => s.playTracks)
  const virtual = useVirtualizer({ count: tracks.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 12 })

  return (
    <div role="table" aria-rowcount={tracks.length} className="flex min-h-0 flex-1 flex-col">
      <div role="row" className={`${cols} h-8 shrink-0 border-b border-line-soft text-[11px] tracking-[0.06em] text-dim uppercase`}>
        <span role="columnheader" className="text-center">#</span>
        <span role="columnheader">Titre</span>
        <span role="columnheader">Album</span>
        <span role="columnheader">Sources</span>
        <span role="columnheader" className="flex justify-end" aria-label="Durée">
          <Clock3 size={13} />
        </span>
      </div>
      {tracks.length === 0 ? (
        <div className="grid flex-1 place-items-center p-10 text-center text-muted">{empty}</div>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pt-1">
          <div className="relative" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((v) => {
              const t = tracks[v.index]
              return (
                <div
                  key={t.id}
                  role="row"
                  onDoubleClick={() => play(tracks, v.index)}
                  className={`${cols} group absolute inset-x-0 rounded-lg hover:bg-surface`}
                  style={{ height: ROW, transform: `translateY(${v.start}px)` }}
                >
                  {t.ids.youtube ? (
                    <button aria-label={`Lire ${t.title}`} onClick={() => play(tracks, v.index)} className="grid place-items-center text-dim tabular-nums hover:text-fg">
                      <span className="group-hover:hidden">{v.index + 1}</span>
                      <Play size={14} className="hidden group-hover:block" />
                    </button>
                  ) : (
                    <span className="text-center text-dim tabular-nums">{v.index + 1}</span>
                  )}
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="size-10 shrink-0 rounded-md" style={{ background: coverGradient(t.album ?? t.title) }} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="block truncate text-xs text-muted">{t.artist}</span>
                    </span>
                  </span>
                  <span className="truncate text-muted">{t.album}</span>
                  <span className="flex items-center gap-2">
                    {order.filter((s) => t.ids[s]).map((s) => (
                      <SourceIcon key={s} source={s} size={15} />
                    ))}
                  </span>
                  <span className="text-right text-muted tabular-nums">{formatDuration(t.durationMs)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

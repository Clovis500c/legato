import { ArrowDown, ArrowUp, Play, Waveform, X } from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { useSettings } from '../../app/settings'
import type { LibraryTrack, Source } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import type { Column } from '../../shared/theme/theme'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { useStore } from '../../app/store'
import { usePlayer } from '../player/store'
import { AddToPlaylist } from './AddToPlaylist'

const ROW = { compact: 40, comfort: 52, airy: 64 }
const order: Source[] = ['spotify', 'youtube', 'apple', 'local']
const width: Record<Column, string> = { album: 'minmax(0,220px)', sources: '76px', duration: '52px' }
const head: Record<Column, string> = { album: 'Album', sources: 'Sources', duration: 'Duration' }

/** Virtualized: only visible rows hit the DOM, so 50k tracks stay smooth. editId = custom playlist shown unfiltered (positions = indexes). */
export function TrackTable({ tracks, empty, editId }: { tracks: LibraryTrack[]; empty: React.ReactNode; editId?: number }) {
  const scroller = useRef<HTMLDivElement>(null)
  const { density, columns } = useSettings((s) => s.settings)
  const play = usePlayer((s) => s.playTracks)
  const editPlaylist = useStore((s) => s.editPlaylist)
  const playingId = usePlayer((s) => s.now?.trackId)
  const row = ROW[density]
  const virtual = useVirtualizer({ count: tracks.length, getScrollElement: () => scroller.current, estimateSize: () => row, overscan: 12 })
  const grid = { gridTemplateColumns: ['32px', 'minmax(0,1fr)', editId ? '156px' : '68px', ...columns.map((c) => width[c])].join(' ') }
  const cover = density === 'compact' ? 28 : density === 'comfort' ? 36 : 46

  return (
    <div role="table" aria-rowcount={tracks.length} className="flex min-h-0 flex-1 flex-col">
      <div role="row" className="grid h-7.5 shrink-0 items-center gap-4 border-b border-line px-2" style={grid}>
        <span role="columnheader" className="kicker text-right">#</span>
        <span role="columnheader" className="kicker">Title</span>
        <span />
        {columns.map((c) => (
          <span key={c} role="columnheader" className={`kicker ${c === 'duration' ? 'text-right' : ''}`}>
            {head[c]}
          </span>
        ))}
      </div>
      {tracks.length === 0 ? (
        <div className="grid flex-1 place-items-center p-10 text-center text-ink-2">{empty}</div>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((v) => {
              const t = tracks[v.index]
              const on = t.id === playingId
              const playable = !!(t.ids.youtube || t.ids.local)
              return (
                <div
                  key={t.id}
                  role="row"
                  onDoubleClick={() => playable && play(tracks, v.index)}
                  className={`group absolute inset-x-0 grid items-center gap-4 border-b border-line-soft px-2 ${on ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                  style={{ ...grid, height: row, transform: `translateY(${v.start}px)` }}
                >
                  <span className="flex justify-end font-mono text-[11px] text-ink-3 tabular-nums">{on ? <Waveform size={14} className="text-accent" /> : String(v.index + 1).padStart(2, '0')}</span>
                  <span className="flex min-w-0 items-center gap-3">
                    <Cover title={t.album ?? t.title} size={cover} />
                    <span className="min-w-0">
                      <span className={`block truncate text-[13px] font-semibold ${on ? 'text-accent' : ''}`}>{t.title}</span>
                      {density !== 'compact' && <span className="block truncate text-xs text-ink-2">{t.artist}</span>}
                    </span>
                    {density === 'compact' && <span className="truncate text-xs text-ink-2">{t.artist}</span>}
                  </span>
                  <span className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {editId !== undefined && (
                      <>
                        <RoundButton label="Move up" kind="plain" size="xs" disabled={v.index === 0} onClick={() => editPlaylist({ type: 'move', id: editId, from: v.index, to: v.index - 1 })}>
                          <ArrowUp size={13} />
                        </RoundButton>
                        <RoundButton label="Move down" kind="plain" size="xs" disabled={v.index === tracks.length - 1} onClick={() => editPlaylist({ type: 'move', id: editId, from: v.index, to: v.index + 1 })}>
                          <ArrowDown size={13} />
                        </RoundButton>
                        <RoundButton label="Remove from playlist" kind="plain" size="xs" onClick={() => editPlaylist({ type: 'remove', id: editId, position: v.index })}>
                          <X size={13} />
                        </RoundButton>
                      </>
                    )}
                    <AddToPlaylist trackIds={[t.id]} label={`Add ${t.title} to a playlist`} />
                    {playable && (
                      <RoundButton label={`Play ${t.title}`} kind="soft" size="xs" onClick={() => play(tracks, v.index)}>
                        <Play weight="fill" size={11} />
                      </RoundButton>
                    )}
                  </span>
                  {columns.map((c) =>
                    c === 'album' ? (
                      <span key={c} className="truncate text-[13px] text-ink-2">
                        {t.album}
                      </span>
                    ) : c === 'sources' ? (
                      <span key={c} className="flex items-center gap-2 text-ink-3">
                        {order.filter((s) => t.ids[s]).map((s) => (
                          <SourceIcon key={s} source={s} size={13} />
                        ))}
                      </span>
                    ) : (
                      <span key={c} className="text-right font-mono text-[11px] text-ink-3 tabular-nums">
                        {formatDuration(t.durationMs)}
                      </span>
                    ),
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

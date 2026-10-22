import { ArrowDown, ArrowUp, CaretDown, CaretUp, ListPlus, Play, Queue, Waveform, X } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import type { LibraryTrack, Source } from '../../shared/api'
import { formatDuration } from '../../shared/format'
import type { Column } from '../../shared/theme/theme'
import type { Sort } from './filter'
import { RoundButton } from '../../shared/ui/controls'
import { trackArt } from '../../shared/art'
import { onMenu } from '../../shared/ui/ContextMenu'
import { trackMenu, tracksMenu } from '../menus'
import { Cover } from '../../shared/ui/Cover'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { useStore } from '../../app/store'
import { isFull, vias } from '../player/sources'
import { usePlayer } from '../player/store'
import { AddToPlaylist } from './AddToPlaylist'
import { removeFromPlaylist, removePositions } from './edits'
import { dragged, endDrag, isTrackDrag, startDrag } from './drag'
import { all, NONE, pick, picked, pickedRows, step, type Selection } from './selection'
import { msg, tr, trn } from '../../shared/i18n/i18n'

const ROW = { compact: 40, comfort: 52, airy: 64 }
const order: Source[] = ['spotify', 'youtube', 'apple', 'local']
const onControl = (e: React.MouseEvent) => e.target instanceof Element && !!e.target.closest('button, a, input, [role="menu"]')
const width: Record<Column, string> = { album: 'minmax(0,220px)', sources: '76px', duration: '52px' }
const head: Record<Column, string> = { album: msg('Album'), sources: msg('Sources'), duration: msg('Duration') }
/** Header click sorts: first click → first sort, again → the second (reverse). Sources can't sort. */
const headSorts: Partial<Record<Column | 'title', [Sort, Sort]>> = { title: ['title', 'title-desc'], album: ['album', 'album'], duration: ['duration', 'duration-short'] }

/**
 * Virtualized: only visible rows hit the DOM, so 50k tracks stay smooth. editId = custom playlist shown unfiltered
 * (positions = indexes). rowActions = extra hover buttons.
 * Like a file list: Ctrl+click / Shift+click pick several songs (a bar offers what to do with them), the list is one
 * tab stop (↑ ↓ Home End Page↑ Page↓ move, Shift extends, Enter plays, Ctrl+A all, Esc clears, Delete removes from a
 * custom playlist). Songs drag to a playlist in the sidebar, or to another row of the custom playlist shown.
 */
export function TrackTable({ tracks, empty, editId, rowActions, sort, onSort }: { tracks: LibraryTrack[]; empty: React.ReactNode; editId?: number; rowActions?: (t: LibraryTrack) => React.ReactNode; sort?: Sort; onSort?: (s: Sort) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const { density, columns, listCovers, clickToPlay } = useSettings(useShallow((s) => ({ density: s.settings.density, columns: s.settings.columns, listCovers: s.settings.listCovers, clickToPlay: s.settings.clickToPlay })))
  const play = usePlayer((s) => s.playTracks)
  const editPlaylist = useStore((s) => s.editPlaylist)
  const playingId = usePlayer((s) => s.now?.trackId)
  const sp = useStore((s) => s.status.spotify.connected)
  const row = ROW[density]
  const virtual = useVirtualizer({ count: tracks.length, getScrollElement: () => scroller.current, estimateSize: () => row, overscan: 12 })
  // Selection belongs to the list it was made in: a new list (filter, sort, other page) starts with none.
  const [held, setHeld] = useState<{ list: LibraryTrack[]; sel: Selection }>({ list: tracks, sel: NONE })
  const sel = held.list === tracks ? held.sel : NONE
  const choose = (next: Selection) => {
    setHeld({ list: tracks, sel: next })
    if (next.cursor !== null) virtual.scrollToIndex(next.cursor, { align: 'auto' })
  }
  const chosen = sel.ids.size > 1 ? picked(sel, tracks) : []
  const [dropAt, setDropAt] = useState<number | null>(null)
  const removeChosen = () => editId !== undefined && void removePositions(editId, pickedRows(sel, tracks)).then(() => choose(NONE))
  const onKey = (e: React.KeyboardEvent) => {
    const at = sel.cursor ?? -1
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? row) / row) - 1)
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: Math.max(0, at - 1), Home: 0, End: tracks.length - 1, PageDown: at + page, PageUp: Math.max(0, at - page) }
    if (e.key in to && !e.altKey && !e.ctrlKey) {
      e.preventDefault()
      return choose(step(sel, tracks, to[e.key], e.shiftKey))
    }
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      return choose(all(tracks))
    }
    if (e.key === 'Escape' && sel.ids.size) return choose({ ...NONE, cursor: sel.cursor })
    if (e.key === 'Enter' && sel.cursor !== null && vias(tracks[sel.cursor], sp).length) return play(tracks, sel.cursor)
    if (e.key === 'Delete' && editId !== undefined && sel.ids.size) removeChosen()
  }
  const grid = { gridTemplateColumns: ['32px', 'minmax(0,1fr)', editId ? '156px' : rowActions ? '124px' : '68px', ...columns.map((c) => width[c])].join(' ') }
  const cover = density === 'compact' ? 28 : density === 'comfort' ? 36 : 46

  return (
    <div role="grid" aria-rowcount={tracks.length} aria-multiselectable className="flex min-h-0 flex-1 flex-col">
      {chosen.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-raised px-3 py-1.5">
          <span className="mr-auto text-[0.8125rem] font-semibold">{trn(chosen.length, '{n} song selected', '{n} songs selected')}</span>
          <RoundButton label={tr('Play')} kind="plain" size="sm" onClick={() => play(chosen, 0)}>
            <Play size={14} weight="fill" />
          </RoundButton>
          <RoundButton label={tr('Play next')} kind="plain" size="sm" onClick={() => usePlayer.getState().enqueue(chosen, true)}>
            <Queue size={15} />
          </RoundButton>
          <RoundButton label={tr('Add to queue')} kind="plain" size="sm" onClick={() => usePlayer.getState().enqueue(chosen, false)}>
            <ListPlus size={15} />
          </RoundButton>
          <AddToPlaylist trackIds={chosen.map((t) => t.id)} label={tr('Add {n} songs to a playlist', { n: chosen.length })} />
          {editId !== undefined && (
            <RoundButton label={tr('Remove from playlist')} kind="plain" size="sm" onClick={removeChosen}>
              <X size={14} />
            </RoundButton>
          )}
          <button onClick={() => choose(NONE)} className="rounded-full px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-bg hover:text-ink">
            {tr('Clear selection')}
          </button>
        </div>
      )}
      <div role="row" className="grid h-7.5 shrink-0 items-center gap-4 border-b border-line px-2" style={grid}>
        <span role="columnheader" className="kicker text-right">#</span>
        <Head label={tr('Title')} sorts={headSorts.title} sort={sort} onSort={onSort} />
        <span />
        {columns.map((c) => (
          <Head key={c} label={tr(head[c])} sorts={headSorts[c]} sort={sort} onSort={onSort} right={c === 'duration'} />
        ))}
      </div>
      {tracks.length === 0 ? (
        <div className="grid flex-1 place-items-center p-10 text-center text-ink-2">{empty}</div>
      ) : (
        <div
          ref={scroller}
          tabIndex={0}
          aria-label={tr('Songs')}
          aria-activedescendant={sel.cursor !== null ? `row-${sel.cursor}` : undefined}
          onKeyDown={onKey}
          onFocus={() => sel.cursor === null && tracks.length && choose({ ...NONE, cursor: 0 })}
          data-list
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          <div className="relative" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((v) => {
              const t = tracks[v.index]
              const on = t.id === playingId
              const playable = vias(t, sp).length > 0
              const isPicked = sel.ids.has(t.id)
              return (
                <div
                  key={v.key}
                  id={`row-${v.index}`}
                  role="row"
                  aria-selected={isPicked}
                  data-cursor={sel.cursor === v.index || undefined}
                  // Row buttons (add to playlist, move…) act on their own, they don't also play. Ctrl / Shift pick.
                  onClick={(e) => {
                    if (onControl(e)) return
                    if (e.ctrlKey || e.metaKey) return choose(pick(sel, tracks, v.index, 'toggle'))
                    if (e.shiftKey) return choose(pick(sel, tracks, v.index, 'range'))
                    choose(pick(sel, tracks, v.index, 'only'))
                    if (clickToPlay === 'single' && playable) play(tracks, v.index)
                  }}
                  onDoubleClick={(e) => clickToPlay === 'double' && playable && !onControl(e) && !e.ctrlKey && !e.shiftKey && play(tracks, v.index)}
                  onContextMenu={onMenu(() =>
                    isPicked && chosen.length > 1
                      ? tracksMenu(chosen, editId !== undefined ? ['-', { label: trn(chosen.length, 'Remove {n} song from playlist', 'Remove {n} songs from playlist'), icon: <X size={16} />, danger: true, onSelect: removeChosen }] : [])
                      : trackMenu(t, { list: tracks, index: v.index, playlistId: editId, position: v.index }),
                  )}
                  draggable
                  onDragStart={(e) => startDrag(e, isPicked && chosen.length > 1 ? chosen.map((x) => x.id) : [t.id], t.title, editId !== undefined && !(isPicked && chosen.length > 1) ? { playlist: editId, row: v.index } : undefined)}
                  onDragEnd={() => {
                    endDrag()
                    setDropAt(null)
                  }}
                  // Custom playlist: a song dropped on another row of it moves there.
                  onDragOver={(e) => {
                    const from = dragged()?.from
                    if (editId === undefined || !isTrackDrag(e) || from?.playlist !== editId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDropAt(v.index)
                  }}
                  onDrop={(e) => {
                    const from = dragged()?.from
                    setDropAt(null)
                    if (editId === undefined || from?.playlist !== editId || from.row === v.index) return
                    e.preventDefault()
                    void editPlaylist({ type: 'move', id: editId, from: from.row, to: v.index })
                  }}
                  className={`group absolute inset-x-0 grid items-center gap-4 border-b border-line-soft px-2 ${playable && clickToPlay === 'single' ? 'cursor-pointer' : ''} ${on ? 'bg-accent-soft' : isPicked ? 'bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] shadow-[inset_3px_0_0_var(--ink-2)]' : 'hover:bg-raised'} ${dropAt === v.index ? ((dragged()?.from?.row ?? 0) < v.index ? 'shadow-[inset_0_-2px_0_var(--accent)]' : 'shadow-[inset_0_2px_0_var(--accent)]') : ''}`}
                  style={{ ...grid, height: row, transform: `translateY(${v.start}px)` }}
                >
                  <span role="gridcell" className="flex justify-end font-mono text-[0.6875rem] text-ink-3 tabular-nums">{on ? <Waveform size={14} className="text-accent" /> : String(v.index + 1).padStart(2, '0')}</span>
                  <span role="gridcell" className="flex min-w-0 items-center gap-3">
                    {listCovers && <Cover title={t.album ?? t.title} art={trackArt(t)} size={cover} />}
                    <span className="min-w-0">
                      <span className={`flex items-center gap-2 text-[0.8125rem] font-semibold ${on ? 'text-accent' : ''}`}>
                        <span className="truncate">{t.title}</span>
                        {playable && !isFull(t, sp) && (
                          <span title={tr('30-second preview')} className="shrink-0 rounded-[3px] border border-line px-1 font-mono text-[0.625rem] font-normal tracking-[0.08em] text-ink-3">
                            {tr('PREVIEW')}
                          </span>
                        )}
                      </span>
                      {density !== 'compact' && <span className="block truncate text-xs text-ink-2">{t.artist}</span>}
                    </span>
                    {density === 'compact' && <span className="truncate text-xs text-ink-2">{t.artist}</span>}
                  </span>
                  <span role="gridcell" className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {editId !== undefined && (
                      <>
                        <RoundButton label={tr('Move up')} kind="plain" size="xs" disabled={v.index === 0} onClick={() => editPlaylist({ type: 'move', id: editId, from: v.index, to: v.index - 1 })}>
                          <ArrowUp size={13} />
                        </RoundButton>
                        <RoundButton label={tr('Move down')} kind="plain" size="xs" disabled={v.index === tracks.length - 1} onClick={() => editPlaylist({ type: 'move', id: editId, from: v.index, to: v.index + 1 })}>
                          <ArrowDown size={13} />
                        </RoundButton>
                        <RoundButton label={tr('Remove from playlist')} kind="plain" size="xs" onClick={() => void removeFromPlaylist(editId, v.index)}>
                          <X size={13} />
                        </RoundButton>
                      </>
                    )}
                    {rowActions?.(t)}
                    <AddToPlaylist trackIds={[t.id]} label={tr('Add {title} to a playlist', { title: t.title })} />
                    {playable && (
                      <RoundButton label={tr('Play {title}', { title: t.title })} kind="soft" size="xs" onClick={() => play(tracks, v.index)}>
                        <Play weight="fill" size={11} />
                      </RoundButton>
                    )}
                  </span>
                  {columns.map((c) =>
                    c === 'album' ? (
                      <span key={c} role="gridcell" className="truncate text-[0.8125rem] text-ink-2">
                        {t.album}
                      </span>
                    ) : c === 'sources' ? (
                      <span key={c} role="gridcell" className="flex items-center gap-2 text-ink-3">
                        {order.filter((s) => t.ids[s]).map((s) => (
                          <SourceIcon key={s} source={s} size={13} />
                        ))}
                      </span>
                    ) : (
                      <span key={c} role="gridcell" className="text-right font-mono text-[0.6875rem] text-ink-3 tabular-nums">
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

/** Column header; a button that sorts the list when the page can sort (aria-sort says how it is). */
function Head({ label, sorts, sort, onSort, right = false }: { label: string; sorts?: [Sort, Sort]; sort?: Sort; onSort?: (s: Sort) => void; right?: boolean }) {
  const now = sorts && sort ? (sort === sorts[0] ? 0 : sort === sorts[1] && sorts[1] !== sorts[0] ? 1 : null) : null
  if (!sorts || !onSort)
    return (
      <span role="columnheader" className={`kicker ${right ? 'text-right' : ''}`}>
        {label}
      </span>
    )
  return (
    <span role="columnheader" aria-sort={now === 0 ? 'ascending' : now === 1 ? 'descending' : 'none'} className={right ? 'flex justify-end' : 'flex'}>
      <button onClick={() => onSort(now === 0 ? sorts[1] : sorts[0])} title={tr('Sort by {column}', { column: label })} className={`kicker flex items-center gap-1 hover:text-ink ${now !== null ? 'text-ink' : ''}`}>
        {label}
        {now === 0 && <CaretUp size={9} weight="bold" />}
        {now === 1 && <CaretDown size={9} weight="bold" />}
      </button>
    </span>
  )
}

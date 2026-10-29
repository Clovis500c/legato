import { CaretRight, ClipboardText, DotsSixVertical, FloppyDisk, MinusCircle, Waveform, X } from '@phosphor-icons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { trackArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { onMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { RoundButton, Toggle } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { dragSource, useDrag, useDropTarget } from '../../shared/ui/drag'
import { trackMenu } from '../menus'
import { fileFormat } from './PlayerBar'
import { queueRows, repeatsAhead, type QueueRow } from './queue'
import { vias } from './sources'
import { fileTitle, isRemote, useNowTrack, usePlayer } from './store'
import { tr, trn } from '../../shared/i18n/i18n'
import { api } from '../../shared/api'
import { askText } from '../../shared/ui/Ask'

const ROW = 60
/** Panels beside Now Playing's cover: a see-through card. */
export const CARD = 'rounded-2xl border border-line-soft bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] p-3'

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

/** The whole queue in play order as a new playlist (recommendations join the library on the way). */
async function saveQueue() {
  const { list, order } = usePlayer.getState()
  const { refreshChanged, notify, go } = useStore.getState()
  const name = await askText({ title: tr('Save the queue as a playlist'), ok: tr('Save'), value: tr('Queue of {date}', { date: new Date().toLocaleDateString() }) })
  if (!name) return
  try {
    const ids: number[] = []
    for (const i of order) {
      const t = list[i]
      if (t) ids.push(isRemote(t) ? await api.addTrack(t) : t.id)
    }
    const id = await api.editPlaylist({ type: 'create', name })
    if (id === null) return
    await api.editPlaylist({ type: 'add', id, trackIds: ids })
    await refreshChanged()
    notify(tr('Saved as the playlist “{name}”', { name }), { action: { label: tr('Open'), run: () => go({ name: 'playlist', id }) } })
  } catch (e) {
    notify(String(e), { kind: 'error' })
  }
}

/** Right-click on the panel (not on a row): the whole queue. */
function queueMenu(onHide: () => void): MenuEntry[] {
  const { list, order, index, shuffle, toggleShuffle, clearNext, dequeue } = usePlayer.getState()
  const queue = order.length > 0
  const ahead = repeatsAhead(order, index, (i) => list[i]?.id)
  const songs = order.flatMap((i) => list[i] ?? [])
  return [
    queue && { label: tr('Save the queue as a playlist'), icon: <FloppyDisk size={16} />, onSelect: () => void saveQueue() },
    queue && { label: tr('Shuffle'), checked: shuffle, onSelect: toggleShuffle },
    ahead.length > 0 && { label: trn(ahead.length, 'Remove {n} repeat', 'Remove {n} repeats'), icon: <MinusCircle size={16} />, onSelect: () => ahead.forEach(dequeue) },
    queue && order.indexOf(index) < order.length - 1 && { label: tr('Clear what’s next'), icon: <X size={16} />, onSelect: clearNext },
    songs.length > 1 && { label: tr('Copy song list'), icon: <ClipboardText size={16} />, onSelect: () => void navigator.clipboard.writeText(songs.map((t) => `${t.artist} – ${t.title}`).join('\n')).then(() => useStore.getState().notify(trn(songs.length, '{n} song copied', '{n} songs copied'))) },
    '-',
    { label: tr('Hide up next'), icon: <CaretRight size={16} />, onSelect: onHide },
  ]
}

/**
 * Queue in play order, shuffle aware: songs already played stay (dimmed, click to play again), then the current one,
 * then what's next. Opens on the current song; virtualized (queues reach thousands). Any song, played ones and the
 * current one too (user's request 2026-10-29), can be dragged into another order (or Alt+↑ / Alt+↓ on a song): above
 * the current song = history, below = still to play. What's next can be cleared.
 */
/** className: the panel's own look (default: a card over Now Playing). */
export function UpNext({ onHide, className = CARD }: { onHide: () => void; className?: string }) {
  const rows = useRows()
  const list = usePlayer((s) => s.list)
  const playAt = usePlayer((s) => s.playAt)
  const move = usePlayer((s) => s.move)
  const clearNext = usePlayer((s) => s.clearNext)
  const nowTitle = usePlayer((s) => s.now?.title ?? '')
  const nowArtist = usePlayer((s) => s.now?.artist ?? '')
  const track = useNowTrack()
  const autoplay = useSettings((s) => s.settings.autoplay)
  const scroller = useRef<HTMLOListElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 8 })
  const current = rows.findIndex((r) => r.current)
  const played = current < 0 ? 0 : current
  const next = rows.length - played - (current < 0 ? 0 : 1)
  // Pointer drag (shared/ui/drag.ts): songs of the queue go anywhere in it; songs from a list only after the current one.
  const queue = current >= 0 && rows[current].i >= 0
  useDropTarget(
    'queue',
    queue
      ? {
          accepts: (d) => d.kind === 'queue' || d.kind === 'tracks',
          clamp: (slot) => (useDrag.getState().data?.kind === 'queue' ? slot : Math.max(current + 1, slot)),
          drop: (d, slot) => {
            const { order, moveTo, enqueueAt } = usePlayer.getState()
            const at = slot === null || slot >= rows.length ? order.length : order.indexOf(rows[slot].i)
            if (d.kind === 'queue') moveTo(d.i, at)
            else if (d.kind === 'tracks') {
              const byId = new Map(useStore.getState().tracks.map((t) => [t.id, t]))
              enqueueAt(d.ids.flatMap((id) => byId.get(id) ?? []), at)
            }
          },
        }
      : null,
  )
  const dropAt = useDrag((s) => (s.target === 'queue' ? s.slot : null))
  const drag = useDrag((s) => (s.data?.kind === 'queue' ? s.data.i : null))
  // New song: bring it to the top, history above it within reach.
  useEffect(() => {
    if (current >= 0) v.scrollToIndex(current, { align: 'start' })
  }, [current, v])

  return (
    <aside onContextMenu={onMenu(() => queueMenu(onHide))} className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-[0.8125rem] font-semibold">{tr('Up next')}</span>
        {next > 0 && rows[current]?.i !== undefined && rows[current].i >= 0 && (
          <button onClick={clearNext} className="rounded-full px-2 py-0.5 text-xs font-medium text-ink-2 hover:bg-raised hover:text-ink">
            {tr('Clear')}
          </button>
        )}
        {queue && (
          <RoundButton label={tr('Save the queue as a playlist')} kind="plain" size="sm" onClick={() => void saveQueue()}>
            <FloppyDisk size={14} />
          </RoundButton>
        )}
        <RoundButton label={tr('Hide up next')} kind="plain" size="sm" onClick={onHide}>
          <CaretRight size={14} />
        </RoundButton>
      </div>
      {/* Where the queue stands: "38 / 1 292 played", bar below (user's request 2026-10-23: the old line was too small). */}
      {rows.length > 1 && (
        <div className="flex flex-col gap-1.5 px-1 pb-1">
          <div className="flex items-baseline justify-between gap-2 text-xs text-ink-2 tabular-nums">
            <span>
              <span className="font-semibold text-ink">{played.toLocaleString()}</span> / {rows.length.toLocaleString()} {tr('played')}
            </span>
            <span>{tr('{n} next', { n: next.toLocaleString() })}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line-soft">
            <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${(played / rows.length) * 100}%` }} />
          </div>
        </div>
      )}
      <ol ref={scroller} data-list data-drop={queue ? 'queue' : undefined} className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: v.getTotalSize() }} className="relative">
          {v.getVirtualItems().map((item) => {
            const r = rows[item.index]
            const t = r.i >= 0 ? list[r.i] : undefined
            const title = r.current ? nowTitle : (t?.title ?? fileTitle(r.path ?? ''))
            const artist = r.current ? nowArtist : (t?.artist ?? fileFormat(r.path) ?? '')
            const art = r.current && track ? trackArt(track) : t ? trackArt(t) : []
            // Every song of the queue moves: history, the current one, what's next.
            const movable = !!t
            const neighbor = (d: 1 | -1) => {
              const n = rows[item.index + d]
              return n && n.i >= 0 ? n.i : null
            }
            const line = dropAt === item.index ? 'shadow-[inset_0_2px_0_var(--accent)]' : dropAt === item.index + 1 && item.index === rows.length - 1 ? 'shadow-[inset_0_-2px_0_var(--accent)]' : ''
            return (
              <li
                key={r.key}
                data-slot={item.index}
                onPointerDown={dragSource(
                  () => (movable ? { kind: 'queue', i: r.i } : null),
                  () => title,
                )}
                className={`group absolute inset-x-0 ${drag === r.i ? 'opacity-40' : ''} ${line}`}
                style={{ top: item.start, height: ROW }}
                onContextMenu={t ? onMenu(() => trackMenu(t, { list, index: r.i, queueIndex: r.i })) : undefined}
              >
                <button
                  // The current one stays enabled: a disabled button takes no pointer, it couldn't be dragged.
                  disabled={!t}
                  onClick={() => !r.current && void playAt(r.i)}
                  onKeyDown={(e) => {
                    const d = e.altKey && e.key === 'ArrowUp' ? -1 : e.altKey && e.key === 'ArrowDown' ? 1 : 0
                    const n = d && movable ? neighbor(d) : null
                    if (n === null) return
                    e.preventDefault()
                    move(r.i, n)
                  }}
                  title={movable ? tr('Drag to change the order (Alt+↑ / Alt+↓)') : undefined}
                  className={`flex h-full w-full items-center gap-3 rounded-lg px-2 text-left ${r.current ? 'bg-raised' : 'enabled:hover:bg-raised'} ${r.played ? 'opacity-55 hover:opacity-100' : ''} ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  {movable && <DotsSixVertical size={12} className="-mr-2 -ml-1.5 shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />}
                  <Cover title={title} art={art} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{title}</span>
                    <span className="block truncate text-xs text-ink-2">{artist}</span>
                  </span>
                  {r.current ? (
                    <span title={tr('Playing')} className="grid size-6 shrink-0 place-items-center rounded-[4px] bg-accent text-on-accent">
                      <Waveform size={14} weight="bold" />
                    </span>
                  ) : t && <span className={`shrink-0 text-xs text-ink-3 tabular-nums ${movable ? 'group-hover:invisible' : ''}`}>{formatDuration(t.durationMs)}</span>}
                </button>
                {movable && !r.current && (
                  <RoundButton label={tr('Remove from Up next')} kind="plain" size="xs" className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => usePlayer.getState().dequeue(r.i)}>
                    <X size={13} />
                  </RoundButton>
                )}
              </li>
            )
          })}
        </div>
        {next === 0 && <li className="py-6 text-center text-ink-3">{tr('Nothing after this track.')}</li>}
      </ol>
      <label className="flex items-center justify-between gap-3 border-t border-line-soft px-2 pt-2.5">
        <span className="flex flex-col">
          <span className="text-xs font-semibold">{tr('Then, similar songs')}</span>
          <span className="text-[0.6875rem] text-ink-3">{tr('When Up next runs out')}</span>
        </span>
        <Toggle label={tr('Then, similar songs')} checked={autoplay} onChange={(on) => useSettings.getState().update({ autoplay: on })} />
      </label>
    </aside>
  )
}

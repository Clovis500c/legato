import { useVirtualizer } from '@tanstack/react-virtual'
import { useId, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { useSettings } from '../../app/settings'
import type { LibraryTrack } from '../../shared/api'
import { artistName } from '../../shared/artistName'
import { fold, formatCount } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { onMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { dragSource } from '../../shared/ui/drag'
import { tracksMenu } from '../menus'
import { pickIn, type Browsed, type How, type Keyed, type Pane as Column, type Picks } from './browse'

const ROW = 28

/** What the panes picked, kept while the app runs: another page and back finds it. */
export const useBrowse = create<Picks>(() => ({ genres: [], artists: [], albums: [] }))

/** Songs' Display options: the column browser on or off. */
export function browserEntry(): MenuEntry {
  const { settings, update } = useSettings.getState()
  return { label: tr('Column browser'), checked: settings.columnBrowser, onSelect: () => update({ columnBrowser: !settings.columnBrowser }) }
}

/**
 * Songs' column browser: genres when songs have one, artists, then their albums; the list below shows what's picked. Like the list: Ctrl / Shift
 * pick several, ↑ ↓ Home End move, letters jump to a name, Esc back to All, double-click or Enter plays, right-click
 * gives the songs' menu, a drag takes them to a playlist.
 */
export function ColumnBrowser({ b, play }: { b: Browsed; play: (tracks: LibraryTrack[]) => void }) {
  // One artist picked: the albums need no artist beside them.
  const one = b.artists.on.size === 1
  return (
    // Shorter on a short window: the list keeps some room (600 px tall at the least).
    <div className={`mb-3 grid h-[clamp(6.5rem,20vh,11rem)] shrink-0 gap-3 ${b.genres ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {b.genres && <Pane label={tr('Genres')} all={trn(b.genres.items.length, '{n} genre', '{n} genres')} column={b.genres} name={(g) => g.genre} onPick={(genres) => useBrowse.setState({ genres, artists: [], albums: [] })} play={play} songs={b.songs} />}
      <Pane label={tr('Artists')} all={trn(b.artists.items.length, '{n} artist', '{n} artists')} column={b.artists} name={(g) => artistName(g.artist)} onPick={(artists) => useBrowse.setState({ artists, albums: [] })} play={play} songs={b.songs} />
      <Pane label={tr('Albums')} all={trn(b.albums.items.length, '{n} album', '{n} albums')} column={b.albums} name={(g) => g.album} sub={one ? undefined : (g) => artistName(g.artist)} onPick={(albums) => useBrowse.setState({ albums })} play={play} songs={b.songs} />
    </div>
  )
}

function Pane<G extends { tracks: LibraryTrack[] }>({ label, all, column, name, sub, onPick, play, songs }: { label: string; all: string; column: Column<G>; name: (g: Keyed<G>) => string; sub?: (g: Keyed<G>) => string; onPick: (keys: string[]) => void; play: (tracks: LibraryTrack[]) => void; songs: LibraryTrack[] }) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const keys = useMemo(() => column.items.map((g) => g.key), [column.items])
  const v = useVirtualizer({ count: keys.length + 1, getScrollElement: () => box.current, estimateSize: () => ROW, overscan: 8 })
  // Row 0 = All. The keyboard's row: the last one clicked while still picked, else the first picked, else All.
  const last = anchor.current !== null && column.on.has(anchor.current) ? anchor.current : [...column.on][0]
  const cursor = last === undefined ? 0 : keys.indexOf(last) + 1
  const choose = (row: number, how: How) => {
    const key = row > 0 ? keys[row - 1] : null
    onPick(pickIn(keys, [...column.on], key, how, anchor.current))
    if (how !== 'range' || anchor.current === null) anchor.current = key
    v.scrollToIndex(row, { align: 'auto' })
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const page = Math.max(1, Math.floor((box.current?.clientHeight ?? ROW) / ROW) - 1)
    const moves: Record<string, number> = { ArrowDown: cursor + 1, ArrowUp: cursor - 1, Home: 0, End: keys.length, PageDown: cursor + page, PageUp: cursor - page }
    if (e.key in moves) {
      e.preventDefault()
      return choose(Math.min(keys.length, Math.max(0, moves[e.key])), e.shiftKey && cursor > 0 ? 'range' : 'only')
    }
    if (e.key === 'Enter') return play(songs)
    if (e.key === 'Escape' && column.on.size) {
      e.stopPropagation()
      return choose(0, 'only')
    }
    // Letters typed within a second find a name starting with them (they don't reach K, V… shortcuts). The same letter
    // again: the next name with it. Letters no name starts with: this one alone.
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault()
      e.stopPropagation()
      const letter = fold(e.key)
      const text = (e.timeStamp - typed.current.at < 1000 ? typed.current.text : '') + letter
      typed.current = { text, at: e.timeStamp }
      const starts = (s: string, from = 0) => {
        const at = (i: number) => fold(name(column.items[i])).startsWith(s)
        for (let i = from; i < column.items.length; i++) if (at(i)) return i
        for (let i = 0; i < from; i++) if (at(i)) return i
        return -1
      }
      const again = text.length > 1 && [...text].every((c) => c === letter)
      const found = again ? starts(letter, cursor) : starts(text)
      const i = found >= 0 ? found : starts(letter)
      if (i >= 0) choose(i + 1, 'only')
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line">
      <p className="shrink-0 border-b border-line px-3 py-1.5 text-xs font-medium text-ink-3">{label}</p>
      {/* data-list: Space plays / pauses here too, a drag scrolls it at its edges. */}
      <div ref={box} role="listbox" aria-label={label} aria-multiselectable aria-activedescendant={`${id}-${cursor}`} tabIndex={0} data-list onKeyDown={onKey} className="min-h-0 flex-1 overflow-y-auto py-1 outline-none">
        <div className="relative" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((r) => {
            const g = r.index ? column.items[r.index - 1] : null
            const on = g ? column.on.has(g.key) : !column.on.size
            const tracks = g ? g.tracks : column.tracks
            return (
              <div
                key={r.key}
                id={`${id}-${r.index}`}
                role="option"
                aria-selected={on}
                data-cursor={r.index === cursor || undefined}
                onClick={(e) => choose(r.index, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'only')}
                onDoubleClick={(e) => !e.ctrlKey && !e.shiftKey && play(tracks)}
                onContextMenu={onMenu(() => tracksMenu(tracks))}
                onPointerDown={dragSource(
                  () => (tracks.length ? { kind: 'tracks', ids: tracks.map((t) => t.id) } : null),
                  () => (g ? name(g) : trn(tracks.length, '{n} song', '{n} songs')),
                )}
                className={`absolute inset-x-1 flex items-center gap-2 rounded-md px-2 text-[0.8125rem] select-none ${on ? 'bg-line font-medium' : 'hover:bg-raised'}`}
                style={{ height: ROW, transform: `translateY(${r.start}px)` }}
              >
                <span className="min-w-0 flex-1 truncate">
                  {g ? name(g) : tr('All')}
                  {g && sub && <span className="font-normal text-ink-3"> · {sub(g)}</span>}
                </span>
                <span className="shrink-0 text-xs font-normal text-ink-3 tabular-nums">{g ? formatCount(g.tracks.length) : all}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

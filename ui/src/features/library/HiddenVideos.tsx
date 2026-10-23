import { CaretDown, MusicNotesSimple } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import type { LibraryTrack } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { markMusic } from './edits'
import { TrackTable } from './TrackTable'
import { onMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { tracksMenu } from '../menus'

/**
 * "N videos hidden because they aren't music · Show": a fold that opens on the list of them (user's request
 * 2026-10-22). Songs, playlists, mixes and Add music's search share it.
 */
export function HiddenFold({ count, children, className = '', menu }: { count: number; children: ReactNode; className?: string; menu?: () => MenuEntry[] }) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className={`flex shrink-0 flex-col rounded-lg border border-line-soft ${className}`}>
      <button onClick={() => setOpen(!open)} onContextMenu={onMenu(() => [{ label: open ? tr('Hide list') : tr('Show'), onSelect: () => setOpen(!open) }, '-', ...(menu?.() ?? [])])} aria-expanded={open} className="flex items-center justify-between gap-3 px-3 py-2 text-left text-xs text-ink-2">
        {trn(count, '{n} video hidden because it isn’t music', '{n} videos hidden because they aren’t music')}
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1 font-medium text-ink hover:bg-raised">
          {open ? tr('Hide list') : tr('Show')}
          <CaretDown size={11} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="border-t border-line-soft">{children}</div>}
    </div>
  )
}

/** Library songs set aside as not music: each playable, "It's music" puts one back for good. Never deleted. */
export function HiddenVideos({ tracks }: { tracks: LibraryTrack[] }) {
  return (
    <HiddenFold count={tracks.length} className="mb-2" menu={() => [{ label: trn(tracks.length, 'It’s music: show {n} video with your songs', 'It’s music: show {n} videos with your songs'), icon: <MusicNotesSimple size={16} />, onSelect: () => void markMusic(tracks.map((t) => t.id), true) }, '-', ...tracksMenu(tracks)]}>
      {/* Grows with the list, up to a cap (one video = one row, no empty box). */}
      <div className="flex max-h-[min(22rem,45vh)] flex-col px-1 py-1">
        <TrackTable
          tracks={tracks}
          empty={null}
          rowActions={(t) => (
            <button onClick={() => void markMusic([t.id], true)} title={tr('Show it with your music from now on')} className="flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[0.6875rem] font-medium whitespace-nowrap text-ink hover:bg-raised">
              <MusicNotesSimple size={11} /> {tr('It’s music')}
            </button>
          )}
        />
      </div>
    </HiddenFold>
  )
}

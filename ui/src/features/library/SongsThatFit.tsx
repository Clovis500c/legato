import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { artistName } from '../../shared/artistName'
import { useMemo, useState } from 'react'
import { useStore } from '../../app/store'
import type { LibraryTrack } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { trackMenu } from '../menus'
import { useMixes } from '../mixes/useMixes'
import { mixTitle } from '../mixes/words'
import { addToPlaylist } from './edits'
import { songsThatFit } from './fit'
import { filterTracks } from './filter'

/** The "Add songs" button's target: the field of the panel under a custom playlist. */
export const FIT_FIELD = 'fit-search'

/**
 * Under a custom playlist: songs of your library that fit it (today's mixes sharing songs with it, its artists), and a
 * field to find any song of the library, each added in one click without leaving the page.
 */
export function SongsThatFit({ id, songs }: { id: number; songs: LibraryTrack[] }) {
  const tracks = useStore((s) => s.tracks)
  const stats = useStore((s) => s.stats)
  const { mixes } = useMixes()
  const [q, setQ] = useState('')
  const inside = useMemo(() => new Set(songs.map((t) => t.id)), [songs])
  const fits = useMemo(() => songsThatFit(songs, tracks, { stats, mixes }), [songs, tracks, stats, mixes])
  const found = useMemo(() => (q.trim() ? filterTracks(tracks, q, 'all').filter((t) => !inside.has(t.id)).slice(0, 8) : []), [tracks, q, inside])
  const rows = q.trim() ? found.map((track) => ({ track, why: artistName(track.artist) })) : fits.map((f) => ({ track: f.track, why: f.mix ? tr('{artist} · in {mix}', { artist: artistName(f.track.artist), mix: mixTitle(mixes!.find((m) => m.id === f.mix)!) }) : tr('{artist} · same artist', { artist: artistName(f.track.artist) }) }))
  return (
    <section className="mx-2 mt-6 mb-4 flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-[0.9375rem] font-semibold">{tr('Songs that fit')}</h2>
          <p className="text-xs text-ink-2">{tr('From your library: same artists and mixes as this playlist')}</p>
        </div>
        <label className="flex h-9 w-72 items-center gap-2 rounded-full border border-line bg-bg px-3.5 focus-within:border-accent-ink">
          <MagnifyingGlass size={15} className="shrink-0 text-ink-3" />
          <input id={FIT_FIELD} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder={tr('Find songs to add')} aria-label={tr('Find songs to add')} className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-ink-3" />
        </label>
      </div>
      {rows.map(({ track, why }) => (
        <div key={track.id} onContextMenu={onMenu(() => trackMenu(track))} className="flex items-center gap-3.5">
          <Cover title={track.album ?? track.title} art={trackArt(track)} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.8125rem] font-semibold">{track.title}</span>
            <span className="truncate text-xs text-ink-2">{why}</span>
          </span>
          <Button variant="ghost" className="px-3.5! py-1.5! text-xs" onClick={() => void addToPlaylist(id, [track.id])}>
            <Plus size={13} /> {tr('Add')}
          </Button>
        </div>
      ))}
      {!rows.length && <p className="py-2 text-xs text-ink-3">{q.trim() ? tr('No matching songs.') : tr('Add a few songs: suggestions follow them.')}</p>}
    </section>
  )
}

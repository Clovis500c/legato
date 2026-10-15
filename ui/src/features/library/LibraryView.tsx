import { Layers, Link2, Music2, Unlink } from 'lucide-react'
import { useMemo } from 'react'
import { useStore } from '../../app/store'
import type { Source } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Button, Chip } from '../../shared/ui/Button'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { filterTracks, libraryStats, type Filter } from './filter'
import { TrackTable } from './TrackTable'

const tabs: { id: Filter; label: string; source?: Source }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'spotify', label: 'Spotify', source: 'spotify' },
  { id: 'youtube', label: 'YouTube', source: 'youtube' },
  { id: 'local', label: 'Local', source: 'local' },
]

export function LibraryView() {
  const { tracks, query, filter, setFilter, go } = useStore()
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const shown = useMemo(() => filterTracks(tracks, query, filter), [tracks, query, filter])
  const tab = (active: boolean) => (active ? 'bg-fg text-bg font-semibold' : 'bg-surface hover:bg-raised')

  return (
    <>
      <header className="flex flex-col gap-2.5">
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">Bibliothèque</h1>
        <div className="flex flex-wrap gap-2">
          <Chip className="bg-surface text-[#c4c4cf]">
            <Music2 size={13} className="text-muted" /> {formatCount(stats.total)} morceaux
          </Chip>
          <Chip className="bg-surface text-[#c4c4cf]">
            <Layers size={13} className="text-muted" /> {stats.sources} {stats.sources > 1 ? 'sources' : 'source'}
          </Chip>
          {stats.total > 0 && (
            <Chip className="bg-[#1d1830] text-[#c4b5fd]">
              <Link2 size={13} className="text-accent" /> {stats.linkedPct} % reliés entre services
            </Chip>
          )}
        </div>
      </header>

      <div role="tablist" aria-label="Filtrer par source" className="flex flex-wrap gap-2">
        {tabs
          .filter((t) => !t.source || stats.perSource[t.source] > 0)
          .map((t) => (
            <button key={t.id} role="tab" aria-selected={filter === t.id} onClick={() => setFilter(t.id)} className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition ${tab(filter === t.id)}`}>
              {t.source && <SourceIcon source={t.source} size={12} />} {t.label}
            </button>
          ))}
        {stats.sources > 1 && stats.unlinked > 0 && (
          <button
            role="tab"
            aria-selected={filter === 'unlinked'}
            onClick={() => setFilter('unlinked')}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition ${filter === 'unlinked' ? 'bg-local text-bg' : 'bg-[#2a1f0e] text-[#fcd34d]'}`}
          >
            <Unlink size={12} /> Non reliés · {formatCount(stats.unlinked)}
          </button>
        )}
      </div>

      <TrackTable
        tracks={shown}
        empty={
          tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-base text-fg">Ta bibliothèque est vide</p>
              <p>Connecte un service puis synchronise pour importer tes playlists.</p>
              <Button onClick={() => go({ name: 'sources' })}>Connecter une source</Button>
            </div>
          ) : (
            'Aucun morceau ne correspond.'
          )
        }
      />
    </>
  )
}

export function PlaylistView({ id }: { id: number }) {
  const { playlists, playlistTracks, query } = useStore()
  const playlist = playlists.find((p) => p.id === id)
  const shown = useMemo(() => filterTracks(playlistTracks, query, 'all'), [playlistTracks, query])
  if (!playlist) return null
  return (
    <>
      <header className="flex flex-col gap-2.5">
        <Chip className="w-fit bg-surface text-muted">
          <SourceIcon source={playlist.source} size={12} /> Playlist
        </Chip>
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">{playlist.name}</h1>
        <p className="text-muted">{formatCount(playlist.trackCount)} titres</p>
      </header>
      <TrackTable tracks={shown} empty="Aucun morceau." />
    </>
  )
}

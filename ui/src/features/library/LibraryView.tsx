import { Copy, MagnifyingGlass, Play, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { fold, formatCount } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, LedChip, RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { sourceLabel } from '../../shared/ui/SourceIcon'
import { isFull, vias } from '../player/sources'
import { usePlayer } from '../player/store'
import { filterTracks, groupAlbums, groupArtists, libraryStats, primaryArtist, sortTracks, type Filter, type Sort } from './filter'
import { TrackTable } from './TrackTable'

const sorts: { id: Sort; label: string }[] = [
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'album', label: 'Album' },
  { id: 'recent', label: 'Recently added' },
  { id: 'duration', label: 'Duration' },
]

const totalTime = (tracks: LibraryTrack[]) => {
  const min = Math.round(tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0) / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} hr ${String(min % 60).padStart(2, '0')} min` : `${min} min`
}

/** Round play button: starts first playable track of the list. Absent if none. */
function PlayAll({ tracks }: { tracks: LibraryTrack[] }) {
  const play = usePlayer((s) => s.playTracks)
  const first = tracks.findIndex((t) => vias(t).length > 0)
  if (first < 0) return null
  return (
    <RoundButton label="Play all" kind="primary" size="lg" onClick={() => play(tracks, first)}>
      <Play weight="fill" size={20} />
    </RoundButton>
  )
}

function SortMenu() {
  const { sort, setSort } = useStore()
  return (
    <label className="flex items-center gap-2">
      <span className="kicker">Sort</span>
      <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="cursor-pointer bg-transparent text-xs font-medium outline-none">
        {sorts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** "Find versions": YouTube match for tracks that only preview or don't play. 1 search each. */
function FindVersions({ tracks }: { tracks: LibraryTrack[] }) {
  const { status, refresh, notify } = useStore()
  const [busy, setBusy] = useState(false)
  if (!tracks.length) return null
  if (!status.youtube.connected) return <span className="font-sans text-xs tracking-normal text-ink-2 normal-case">Connect YouTube to find full versions.</span>
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.findVersions(tracks.map((t) => t.id))
      await refresh()
      notify(`Full versions found: ${r.found} of ${r.found + r.missing} · ${r.youtubeSearchesLeft} YouTube searches left today`)
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="ghost" className="ml-auto py-1! font-sans text-xs tracking-normal normal-case" disabled={busy} onClick={run}>
      <MagnifyingGlass size={13} /> {busy ? 'Searching…' : `Find full versions (${formatCount(Math.min(tracks.length, 100))})`}
    </Button>
  )
}

/** What plays in full, what only previews, what can't play. */
function Playability({ tracks }: { tracks: LibraryTrack[] }) {
  const full = tracks.filter(isFull).length
  const missing = tracks.filter((t) => !isFull(t))
  const preview = missing.filter((t) => vias(t).length > 0).length
  if (!tracks.length) return null
  return (
    <p className="mb-3 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line-soft bg-recess px-3.5 py-2.5 font-mono text-[10px] tracking-[0.08em] uppercase">
      <span className="flex items-center gap-2">
        <Led on /> {formatCount(full)} playable in full
      </span>
      {preview > 0 && (
        <span className="flex items-center gap-2 text-ink-2">
          <Led on={false} /> {formatCount(preview)} as 30 s preview
        </span>
      )}
      {missing.length > preview && (
        <span className="flex items-center gap-2 text-ink-2">
          <Led on={false} /> {formatCount(missing.length - preview)} with no playable source
        </span>
      )}
      {missing.length === 0 && <span className="font-sans text-xs tracking-normal text-ink-2 normal-case">Local file first, then the official YouTube player, then the Apple Music preview.</span>}
      <FindVersions tracks={missing} />
    </p>
  )
}

export function SongsView() {
  const { tracks, query, filter, setFilter, sort, go } = useStore()
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const shown = useMemo(() => sortTracks(filterTracks(tracks, query, filter), sort), [tracks, query, filter, sort])
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: stats.total },
    ...(['youtube', 'spotify', 'apple', 'local'] as const).filter((s) => stats.perSource[s]).map((s) => ({ id: s, label: sourceLabel[s], count: stats.perSource[s] })),
    ...(stats.sources > 1 && stats.unlinked ? [{ id: 'unlinked' as const, label: 'Unlinked', count: stats.unlinked }] : []),
  ]

  return (
    <>
      <PageHeader kicker={`Library · ${stats.sources} source${stats.sources > 1 ? 's' : ''}${stats.total ? ` · ${stats.linkedPct}% linked` : ''}`} title="Songs" actions={<PlayAll tracks={shown} />} />
      <div className="flex shrink-0 items-center justify-between gap-4 pb-3.5">
        <div role="tablist" aria-label="Filter by source" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <LedChip key={c.id} on={filter === c.id} label={c.label} count={formatCount(c.count)} onClick={() => setFilter(c.id)} />
          ))}
        </div>
        <SortMenu />
      </div>
      <Playability tracks={shown} />
      <TrackTable
        tracks={shown}
        empty={
          tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-base text-ink">Your library is empty</p>
              <p>Connect a service and sync, add a music folder, or paste a YouTube link (Ctrl+V).</p>
              <Button onClick={() => go({ name: 'settings', section: 'sources' })}>Connect a source</Button>
            </div>
          ) : (
            'No matching songs.'
          )
        }
      />
    </>
  )
}

/** Click to rename (custom playlists). Saves on Enter / blur, Escape cancels. */
function EditableTitle({ id, name }: { id: number; name: string }) {
  const editPlaylist = useStore((s) => s.editPlaylist)
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null)
    return (
      <button onClick={() => setDraft(name)} title="Rename" className="truncate text-left hover:underline hover:decoration-line">
        {name}
      </button>
    )
  const save = () => {
    if (draft.trim() && draft.trim() !== name) void editPlaylist({ type: 'rename', id, name: draft })
    setDraft(null)
  }
  return <input autoFocus value={draft} maxLength={100} aria-label="Playlist name" onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && setDraft(null))} className="w-full bg-transparent outline-none" />
}

export function PlaylistView({ id }: { id: number }) {
  const { playlists, playlistTracks, query, editPlaylist, go } = useStore()
  const playlist = playlists.find((p) => p.id === id)
  const shown = useMemo(() => filterTracks(playlistTracks, query, 'all'), [playlistTracks, query])
  if (!playlist) return null
  const duplicate = async () => {
    const copy = await editPlaylist({ type: 'duplicate', id, name: `${playlist.name} (copy)` })
    if (copy !== null) go({ name: 'playlist', id: copy })
  }
  return (
    <>
      <PageHeader
        art={<Cover title={playlist.name} size={150} />}
        kicker={playlist.custom ? 'Custom playlist' : `Playlist · ${sourceLabel[playlist.source]} · imported`}
        title={playlist.custom ? <EditableTitle key={playlist.name} id={id} name={playlist.name} /> : playlist.name}
        sub={<span className="font-mono text-[11px] tracking-[0.06em] uppercase">{formatCount(playlist.trackCount)} tracks · {totalTime(playlistTracks)}</span>}
        actions={
          <>
            <PlayAll tracks={shown} />
            <RoundButton label={playlist.custom ? 'Duplicate' : 'Duplicate as custom playlist'} onClick={duplicate}>
              <Copy size={16} />
            </RoundButton>
            {playlist.custom && (
              <RoundButton
                label="Delete playlist"
                onClick={async () => {
                  if (!confirm(`Delete “${playlist.name}”? The songs stay in your library.`)) return
                  await editPlaylist({ type: 'delete', id })
                  go({ name: 'songs' })
                }}
              >
                <Trash size={16} />
              </RoundButton>
            )}
          </>
        }
      />
      <Playability tracks={playlistTracks} />
      <TrackTable tracks={shown} empty={playlist.custom ? 'Empty playlist: add songs from Songs with the “Add to playlist” button.' : 'No songs.'} editId={playlist.custom && !query ? id : undefined} />
    </>
  )
}

export function AlbumsView() {
  const { tracks, query, go } = useStore()
  const albums = useMemo(() => groupAlbums(filterTracks(tracks, query, 'all')), [tracks, query])
  return (
    <>
      <PageHeader kicker="Library" title="Albums" sub={`${formatCount(albums.length)} albums`} />
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {albums.length === 0 ? (
          <p className="py-10 text-center text-ink-2">No albums yet.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
            {albums.map((a) => (
              <li key={`${a.album}-${a.artist}`}>
                <button onClick={() => go({ name: 'album', album: a.album, artist: a.artist })} className="group flex w-full flex-col gap-2 text-left">
                  <span className="relative aspect-square w-full">
                    <Cover title={a.album} size={150} className="size-full! text-[28px]!" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold group-hover:underline">{a.album}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {a.artist} · {a.tracks.length} track{a.tracks.length > 1 ? 's' : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

export function AlbumView({ album, artist }: { album: string; artist: string }) {
  const tracks = useStore((s) => s.tracks)
  const shown = useMemo(() => tracks.filter((t) => t.album && fold(t.album) === fold(album) && fold(primaryArtist(t.artist)) === fold(artist)), [tracks, album, artist])
  return (
    <>
      <PageHeader art={<Cover title={album} size={150} />} kicker={`Album · ${artist}`} title={album} sub={<span className="font-mono text-[11px] tracking-[0.06em] uppercase">{shown.length} tracks · {totalTime(shown)}</span>} actions={<PlayAll tracks={shown} />} />
      <TrackTable tracks={shown} empty="No songs." />
    </>
  )
}

export function ArtistsView() {
  const { tracks, query, go } = useStore()
  const artists = useMemo(() => groupArtists(filterTracks(tracks, query, 'all')), [tracks, query])
  return (
    <>
      <PageHeader kicker="Library" title="Artists" sub={`${formatCount(artists.length)} artists`} />
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {artists.map((a, i) => (
          <li key={a.artist}>
            <button onClick={() => go({ name: 'artist', artist: a.artist })} className="flex w-full items-center gap-4 border-b border-line-soft px-2 py-2.5 text-left hover:bg-raised">
              <span className="w-8 text-right font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              <Cover title={a.artist} size={36} className="rounded-full!" />
              <span className="flex-1 truncate text-[13px] font-semibold">{a.artist}</span>
              <span className="font-mono text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                {a.count} track{a.count > 1 ? 's' : ''} · {a.albums} album{a.albums > 1 ? 's' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ArtistView({ artist }: { artist: string }) {
  const tracks = useStore((s) => s.tracks)
  const shown = useMemo(() => tracks.filter((t) => fold(primaryArtist(t.artist)) === fold(artist)), [tracks, artist])
  return (
    <>
      <PageHeader art={<Cover title={artist} size={120} className="rounded-full!" />} kicker="Artist" title={artist} sub={<span className="font-mono text-[11px] tracking-[0.06em] uppercase">{shown.length} tracks · {totalTime(shown)}</span>} actions={<PlayAll tracks={shown} />} />
      <TrackTable tracks={shown} empty="No songs." />
    </>
  )
}

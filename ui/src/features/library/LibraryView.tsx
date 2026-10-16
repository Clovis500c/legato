import { CaretDown, Copy, MagnifyingGlass, Play, ShareNetwork, SortAscending, Trash } from '@phosphor-icons/react'
import { useCallback, useMemo, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { fold, formatCount } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, LedChip, RoundButton, Segmented } from '../../shared/ui/controls'
import { firstArt, trackArt } from '../../shared/art'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { playlistMenu, tracksMenu } from '../menus'
import { PageHeader } from '../../shared/ui/PageHeader'
import { sourceLabel } from '../../shared/ui/SourceIcon'
import { isFull, vias } from '../player/sources'
import { usePlayer } from '../player/store'
import { SharePanel } from '../share/SharePanel'
import { ExportYoutube } from './ExportYoutube'
import { PlaylistCover } from './PlaylistCover'
import { filterTracks, groupAlbums, groupArtists, groupStats, libraryStats, primaryArtist, sortGroups as orderGroups, sortTracks, type Filter, type GroupSort, type Sort } from './filter'
import { TrackTable } from './TrackTable'

/** YouTube-like sort list, in groups. Manual only on playlists. */
const sortGroups: { id: Sort; label: string }[][] = [
  [{ id: 'manual', label: 'Manual' }],
  [
    { id: 'added-new', label: 'Date added (newest)' },
    { id: 'added-old', label: 'Date added (oldest)' },
  ],
  [
    { id: 'most-played', label: 'Most played' },
    { id: 'recently-played', label: 'Recently played' },
  ],
  [
    { id: 'title', label: 'Title (A–Z)' },
    { id: 'title-desc', label: 'Title (Z–A)' },
    { id: 'artist', label: 'Artist (A–Z)' },
    { id: 'album', label: 'Album (A–Z)' },
  ],
  [
    { id: 'duration', label: 'Longest first' },
    { id: 'duration-short', label: 'Shortest first' },
  ],
  [{ id: 'random', label: 'Random' }],
]

const totalTime = (tracks: LibraryTrack[]) => {
  const min = Math.round(tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0) / 60_000)
  return min >= 60 ? `${Math.floor(min / 60)} hr ${String(min % 60).padStart(2, '0')} min` : `${min} min`
}

/** Round play button: starts first playable track of the list. Absent if none. */
function PlayAll({ tracks }: { tracks: LibraryTrack[] }) {
  const play = usePlayer((s) => s.playTracks)
  const sp = useStore((s) => s.status.spotify.connected)
  const first = tracks.findIndex((t) => vias(t, sp).length > 0)
  if (first < 0) return null
  return (
    <RoundButton label="Play all" kind="primary" size="lg" onClick={() => play(tracks, first)}>
      <Play weight="fill" size={20} />
    </RoundButton>
  )
}

/** Dropdown like YouTube's: current sort on the button, list opens under it. */
function SortButton<T extends string>({ groups, value, onPick }: { groups: { id: T; label: string }[][]; value: T; onPick: (v: T) => void }) {
  const items: MenuEntry[] = groups.flatMap((g, i) => [i > 0 && '-', ...g.map((s) => ({ label: s.label, checked: value === s.id, onSelect: () => onPick(s.id) }))])
  return (
    <button
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openMenu({ clientX: r.left, clientY: r.bottom + 6, target: e.currentTarget, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent, items)
      }}
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium hover:bg-raised"
    >
      <SortAscending size={15} className="text-ink-3" /> {groups.flat().find((x) => x.id === value)?.label ?? groups[0][0].label} <CaretDown size={12} className="text-ink-3" />
    </button>
  )
}

/** Songs sort. playlist = adds Manual. */
function SortMenu({ playlist = false }: { playlist?: boolean }) {
  const { sort, playlistSort, setSort, setPlaylistSort } = useStore()
  return <SortButton groups={sortGroups.filter((g) => playlist || g[0].id !== 'manual')} value={playlist ? playlistSort : sort} onPick={playlist ? setPlaylistSort : setSort} />
}

const albumSorts: { id: GroupSort; label: string }[][] = [
  [
    { id: 'name', label: 'Name (A–Z)' },
    { id: 'name-desc', label: 'Name (Z–A)' },
    { id: 'artist', label: 'Artist (A–Z)' },
  ],
  [
    { id: 'added-new', label: 'Date added (newest)' },
    { id: 'added-old', label: 'Date added (oldest)' },
  ],
  [
    { id: 'most-played', label: 'Most played' },
    { id: 'recently-played', label: 'Recently played' },
  ],
  [
    { id: 'songs', label: 'Most songs' },
    { id: 'length', label: 'Longest' },
  ],
  [{ id: 'random', label: 'Random' }],
]
// Artists: no artist sort, Most albums next to Most songs.
const artistSorts: { id: GroupSort; label: string }[][] = albumSorts.map((g) => g.filter((x) => x.id !== 'artist').flatMap((x) => (x.id === 'songs' ? [x, { id: 'albums' as const, label: 'Most albums' }] : [x])))

/** Source chips with counts, for a list of songs. */
function SourceChips({ tracks, value, onChange }: { tracks: LibraryTrack[]; value: Filter; onChange: (f: Filter) => void }) {
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: stats.total },
    ...(['youtube', 'spotify', 'apple', 'local'] as const).filter((s) => stats.perSource[s]).map((s) => ({ id: s, label: sourceLabel[s], count: stats.perSource[s] })),
    ...(stats.sources > 1 && stats.unlinked ? [{ id: 'unlinked' as const, label: 'Unlinked', count: stats.unlinked }] : []),
  ]
  return (
    <div role="tablist" aria-label="Filter by source" className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <LedChip key={c.id} on={value === c.id} label={c.label} count={formatCount(c.count)} onClick={() => onChange(c.id)} />
      ))}
    </div>
  )
}

/** Albums / Artists bar: source chips, how many songs you have of it, sort. */
function GroupBar({ page, tracks }: { page: 'albumView' | 'artistView'; tracks: LibraryTrack[] }) {
  const v = useStore((s) => s[page])
  const setGroupView = useStore((s) => s.setGroupView)
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3.5">
      <SourceChips tracks={tracks} value={v.filter} onChange={(filter) => setGroupView(page, { filter })} />
      <div className="flex items-center gap-2">
        <Segmented
          label="How many songs"
          value={v.size}
          onChange={(size) => setGroupView(page, { size })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'several', label: '2+ songs' },
            { value: 'one', label: '1 song' },
          ]}
        />
        <SortButton groups={page === 'albumView' ? albumSorts : artistSorts} value={v.sort} onPick={(sort) => setGroupView(page, { sort })} />
      </div>
    </div>
  )
}

/** "Find versions": YouTube match for tracks that only preview or don't play. 1 search each. */
function FindVersions({ tracks }: { tracks: LibraryTrack[] }) {
  const { status, refresh, notify } = useStore()
  const [busy, setBusy] = useState(false)
  if (!tracks.length) return null
  if (!status.youtube.connected) return <span className="font-sans text-xs tracking-normal text-ink-2 normal-case">Sign in to YouTube Music (Settings › Accounts) to find full versions.</span>
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.findVersions(tracks.map((t) => t.id))
      await refresh()
      notify(`Full versions found: ${r.found} of ${r.found + r.missing}`)
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="ghost" className="ml-auto py-1! font-sans text-xs tracking-normal normal-case" disabled={busy} onClick={run}>
      <MagnifyingGlass size={13} /> {busy ? 'Searching…' : `Find full versions (${formatCount(Math.min(tracks.length, 150))})`}
    </Button>
  )
}

/** What plays in full, what only previews, what can't play. */
function Playability({ tracks }: { tracks: LibraryTrack[] }) {
  const sp = useStore((s) => s.status.spotify.connected)
  const full = tracks.filter((t) => isFull(t, sp)).length
  const missing = tracks.filter((t) => !isFull(t, sp))
  const preview = missing.filter((t) => vias(t, sp).length > 0).length
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
  const { tracks, query, filter, setFilter, sort, go, stats: plays, seed } = useStore()
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const shown = useMemo(() => sortTracks(filterTracks(tracks, query, filter), sort, { stats: plays, seed }), [tracks, query, filter, sort, plays, seed])

  return (
    <>
      <PageHeader kicker={`Library · ${stats.sources} source${stats.sources > 1 ? 's' : ''}${stats.total ? ` · ${stats.linkedPct}% linked` : ''}`} title="Songs" actions={<PlayAll tracks={shown} />} />
      <div className="flex shrink-0 items-center justify-between gap-4 pb-3.5">
        <SourceChips tracks={tracks} value={filter} onChange={setFilter} />
        <SortMenu />
      </div>
      <Playability tracks={shown} />
      <TrackTable
        tracks={shown}
        empty={
          tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-base text-ink">Your library is empty</p>
              <p>Import your YouTube Music playlists: sign in with Google in Accounts, they come in on their own.</p>
              <Button onClick={() => go({ name: 'settings', section: 'sources' })}>Import from YouTube Music</Button>
              <p className="text-xs">Or add a music folder in Accounts, paste a YouTube or Spotify playlist link (Ctrl+V), or search in Add music.</p>
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
  const { playlists, playlistTracks, query, editPlaylist, go, playlistSort, stats, seed } = useStore()
  const playlist = playlists.find((p) => p.id === id)
  const newestFirst = playlist?.newestFirst ?? false
  const shown = useMemo(() => sortTracks(filterTracks(playlistTracks, query, 'all'), playlistSort, { stats, seed, positional: true, newestFirst }), [playlistTracks, query, playlistSort, stats, seed, newestFirst])
  const sharing = useStore((s) => s.sharing === id)
  const closeShare = useCallback(() => useStore.setState({ sharing: null }), [])
  if (!playlist) return null
  const duplicate = async () => {
    const copy = await editPlaylist({ type: 'duplicate', id, name: `${playlist.name} (copy)` })
    if (copy !== null) go({ name: 'playlist', id: copy })
  }
  return (
    <>
      <PageHeader
        onContextMenu={onMenu(() => playlistMenu(playlist))}
        art={<PlaylistCover p={playlist} size={150} big />}
        kicker={playlist.custom ? 'Custom playlist' : `Playlist · ${sourceLabel[playlist.source]} · imported`}
        title={playlist.custom ? <EditableTitle key={playlist.name} id={id} name={playlist.name} /> : playlist.name}
        sub={<span className="font-mono text-[11px] tracking-[0.06em] uppercase">{formatCount(playlist.trackCount)} tracks · {totalTime(playlistTracks)}</span>}
        actions={
          <>
            <PlayAll tracks={shown} />
            <RoundButton label="Share playlist" onClick={() => useStore.setState({ sharing: id })} disabled={!playlistTracks.length}>
              <ShareNetwork size={16} />
            </RoundButton>
            {!(playlist.source === 'youtube' && !playlist.custom) && playlistTracks.length > 0 && <ExportYoutube id={id} />}
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
      <div className="flex shrink-0 justify-end pb-1">
        <SortMenu playlist />
      </div>
      <Playability tracks={playlistTracks} />
      {sharing && <SharePanel id={id} name={playlist.name} onClose={closeShare} />}
      <TrackTable tracks={shown} empty={playlist.custom ? 'Empty playlist: add songs from Songs with the “Add to playlist” button.' : 'No songs.'} editId={playlist.custom && !query && playlistSort === 'manual' ? id : undefined} />
    </>
  )
}

export function AlbumsView() {
  const { tracks, query, go, albumView: v, stats, seed } = useStore()
  const all = useMemo(() => tracks.filter((t) => t.album), [tracks])
  const albums = useMemo(() => orderGroups(groupAlbums(filterTracks(all, query, v.filter)).map((g) => ({ ...g, name: g.album })), v.sort, { size: v.size, stats, seed }), [all, query, v, stats, seed])
  return (
    <>
      <PageHeader kicker="Library" title="Albums" sub={`${formatCount(albums.length)} albums`} />
      <GroupBar page="albumView" tracks={all} />
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {albums.length === 0 ? (
          <p className="py-10 text-center text-ink-2">{all.length ? 'No matching albums.' : 'No albums yet.'}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
            {albums.map((a) => (
              <li key={`${a.album}-${a.artist}`} onContextMenu={onMenu(() => tracksMenu(a.tracks, ['-', { label: 'Go to artist', onSelect: () => go({ name: 'artist', artist: a.artist }) }]))}>
                <button onClick={() => go({ name: 'album', album: a.album, artist: a.artist })} className="group flex w-full flex-col gap-2 text-left">
                  <span className="relative aspect-square w-full">
                    <Cover title={a.album} art={firstArt(a.tracks)} size={150} className="size-full! text-[28px]!" />
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
      <PageHeader onContextMenu={onMenu(() => tracksMenu(shown, ['-', { label: 'Go to artist', onSelect: () => useStore.getState().go({ name: 'artist', artist }) }]))} art={<Cover title={album} art={firstArt(shown)} size={150} />} kicker={`Album · ${artist}`} title={album} sub={<span className="font-mono text-[11px] tracking-[0.06em] uppercase">{shown.length} tracks · {totalTime(shown)}</span>} actions={<PlayAll tracks={shown} />} />
      <TrackTable tracks={shown} empty="No songs." />
    </>
  )
}

export function ArtistsView() {
  const { tracks, query, go, artistView: v, stats, seed } = useStore()
  const artists = useMemo(() => orderGroups(groupArtists(filterTracks(tracks, query, v.filter)).map((g) => ({ ...g, name: g.artist })), v.sort, { size: v.size, stats, seed }), [tracks, query, v, stats, seed])
  return (
    <>
      <PageHeader kicker="Library" title="Artists" sub={`${formatCount(artists.length)} artists`} />
      <GroupBar page="artistView" tracks={tracks} />
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {artists.length === 0 && <p className="py-10 text-center text-ink-2">No matching artists.</p>}
        {artists.map((a, i) => (
          <li key={a.artist} onContextMenu={onMenu(() => tracksMenu(a.tracks))}>
            <button onClick={() => go({ name: 'artist', artist: a.artist })} className="flex w-full items-center gap-4 border-b border-line-soft px-2 py-2.5 text-left hover:bg-raised">
              <span className="w-8 text-right font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              <Cover title={a.artist} art={trackArt(a.cover)} size={36} className="rounded-full!" />
              <span className="flex-1 truncate text-[13px] font-semibold">{a.artist}</span>
              <span className="font-mono text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                {a.count} track{a.count > 1 ? 's' : ''} · {a.albums} album{a.albums > 1 ? 's' : ''}
                {v.sort === 'most-played' && ` · ${groupStats(a, stats).plays} plays`}
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
      <PageHeader onContextMenu={onMenu(() => tracksMenu(shown))} art={<Cover title={artist} art={firstArt(shown)} size={120} className="rounded-full!" />} kicker="Artist" title={artist} sub={<span className="font-mono text-[11px] tracking-[0.06em] uppercase">{shown.length} tracks · {totalTime(shown)}</span>} actions={<PlayAll tracks={shown} />} />
      <TrackTable tracks={shown} empty="No songs." />
    </>
  )
}

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
import { filterTracks, groupAlbums, groupArtists, groupStats, libraryStats, musicOnly, primaryArtist, sortGroups as orderGroups, sortTracks, type Filter, type GroupSort, type Sort } from './filter'
import { TrackTable } from './TrackTable'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { ask } from '../../shared/ui/Ask'

/** YouTube-like sort list, in groups. Manual only on playlists. */
const sortGroups: { id: Sort; label: string }[][] = [
  [{ id: 'manual', label: msg('Manual') }],
  [
    { id: 'added-new', label: msg('Date added (newest)') },
    { id: 'added-old', label: msg('Date added (oldest)') },
  ],
  [
    { id: 'most-played', label: msg('Most played') },
    { id: 'recently-played', label: msg('Recently played') },
  ],
  [
    { id: 'title', label: msg('Title (A–Z)') },
    { id: 'title-desc', label: msg('Title (Z–A)') },
    { id: 'artist', label: msg('Artist (A–Z)') },
    { id: 'album', label: msg('Album (A–Z)') },
  ],
  [
    { id: 'duration', label: msg('Longest first') },
    { id: 'duration-short', label: msg('Shortest first') },
  ],
  [{ id: 'random', label: msg('Random') }],
]

const totalTime = (tracks: LibraryTrack[]) => {
  const min = Math.round(tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0) / 60_000)
  return min >= 60 ? tr('{h} hr {m} min', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') }) : tr('{m} min', { m: min })
}

/** Round play button: starts first playable track of the list. Absent if none. */
function PlayAll({ tracks }: { tracks: LibraryTrack[] }) {
  const play = usePlayer((s) => s.playTracks)
  const sp = useStore((s) => s.status.spotify.connected)
  const first = tracks.findIndex((t) => vias(t, sp).length > 0)
  if (first < 0) return null
  return (
    <RoundButton label={tr('Play all')} kind="primary" size="lg" onClick={() => play(tracks, first)}>
      <Play weight="fill" size={20} />
    </RoundButton>
  )
}

/** Dropdown like YouTube's: current sort on the button, list opens under it. */
function SortButton<T extends string>({ groups, value, onPick }: { groups: { id: T; label: string }[][]; value: T; onPick: (v: T) => void }) {
  const items: MenuEntry[] = groups.flatMap((g, i) => [i > 0 && '-', ...g.map((s) => ({ label: tr(s.label), checked: value === s.id, onSelect: () => onPick(s.id) }))])
  return (
    <button
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openMenu({ clientX: r.left, clientY: r.bottom + 6, target: e.currentTarget, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent, items)
      }}
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-raised"
    >
      <SortAscending size={15} className="text-ink-3" /> {tr(groups.flat().find((x) => x.id === value)?.label ?? groups[0][0].label)} <CaretDown size={12} className="text-ink-3" />
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
    { id: 'name', label: msg('Name (A–Z)') },
    { id: 'name-desc', label: msg('Name (Z–A)') },
    { id: 'artist', label: msg('Artist (A–Z)') },
  ],
  [
    { id: 'added-new', label: msg('Date added (newest)') },
    { id: 'added-old', label: msg('Date added (oldest)') },
  ],
  [
    { id: 'most-played', label: msg('Most played') },
    { id: 'recently-played', label: msg('Recently played') },
  ],
  [
    { id: 'songs', label: msg('Most songs') },
    { id: 'length', label: msg('Longest') },
  ],
  [{ id: 'random', label: msg('Random') }],
]
// Artists: no artist sort, Most albums next to Most songs.
const artistSorts: { id: GroupSort; label: string }[][] = albumSorts.map((g) => g.filter((x) => x.id !== 'artist').flatMap((x) => (x.id === 'songs' ? [x, { id: 'albums' as const, label: msg('Most albums') }] : [x])))

/** Source chips with counts, for a list of songs. */
function SourceChips({ tracks, value, onChange }: { tracks: LibraryTrack[]; value: Filter; onChange: (f: Filter) => void }) {
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: msg('All'), count: stats.total },
    ...(['youtube', 'spotify', 'apple', 'local'] as const).filter((s) => stats.perSource[s]).map((s) => ({ id: s, label: sourceLabel[s], count: stats.perSource[s] })),
    ...(stats.sources > 1 && stats.unlinked ? [{ id: 'unlinked' as const, label: msg('Unlinked'), count: stats.unlinked }] : []),
  ]
  return (
    <div role="tablist" aria-label={tr('Filter by source')} className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <LedChip key={c.id} on={value === c.id} label={tr(c.label)} count={formatCount(c.count)} onClick={() => onChange(c.id)} />
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
          label={tr('How many songs')}
          value={v.size}
          onChange={(size) => setGroupView(page, { size })}
          options={[
            { value: 'all', label: tr('All') },
            { value: 'several', label: tr('2+ songs') },
            { value: 'one', label: tr('1 song') },
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
  if (!status.youtube.connected) return <span className="font-sans text-xs tracking-normal text-ink-2 normal-case">{tr('Sign in to YouTube Music (Settings › Accounts) to find full versions.')}</span>
  const run = async () => {
    setBusy(true)
    try {
      const r = await api.findVersions(tracks.map((t) => t.id))
      await refresh()
      notify(tr('Full versions found: {found} of {total}', { found: r.found, total: r.found + r.missing }))
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="ghost" className="ml-auto py-1! font-sans text-xs tracking-normal normal-case" disabled={busy} onClick={run}>
      <MagnifyingGlass size={13} /> {busy ? tr('Searching…') : tr('Find full versions ({n})', { n: formatCount(Math.min(tracks.length, 150)) })}
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
    <p className="mb-3 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-line-soft bg-recess px-3.5 py-2.5 font-mono text-[0.625rem] tracking-[0.08em] uppercase">
      <span className="flex items-center gap-2">
        <Led on /> {trn(full, '{n} song playable in full', '{n} songs playable in full')}
      </span>
      {preview > 0 && (
        <span className="flex items-center gap-2 text-ink-2">
          <Led on={false} /> {trn(preview, '{n} as 30 s preview', '{n} as 30 s preview')}
        </span>
      )}
      {missing.length > preview && (
        <span className="flex items-center gap-2 text-ink-2">
          <Led on={false} /> {trn(missing.length - preview, '{n} with no playable source', '{n} with no playable source')}
        </span>
      )}
      {missing.length === 0 && <span className="font-sans text-xs tracking-normal text-ink-2 normal-case">{tr('Local file first, then the official YouTube player, then the Apple Music preview.')}</span>}
      <FindVersions tracks={missing} />
    </p>
  )
}

/** "N videos hidden because they aren't music · Show": imports bring talks and games along, set aside, never deleted. */
function NotMusicNotice({ hidden }: { hidden: number }) {
  const showing = useStore((s) => s.showNotMusic)
  if (!hidden) return null
  return (
    <p className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-line-soft px-3 py-2 text-xs text-ink-2">
      {showing ? trn(hidden, 'Showing {n} video that doesn’t look like music', 'Showing {n} videos that don’t look like music') : trn(hidden, '{n} video hidden because it isn’t music', '{n} videos hidden because they aren’t music')}
      <button onClick={() => useStore.setState({ showNotMusic: !showing })} className="rounded-full border border-line px-3 py-1 font-medium text-ink hover:bg-raised">
        {showing ? tr('Hide them') : tr('Show')}
      </button>
    </p>
  )
}

export function SongsView() {
  const { tracks, query, filter, setFilter, sort, go, stats: plays, seed, showNotMusic } = useStore()
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const music = useMemo(() => musicOnly(tracks, showNotMusic), [tracks, showNotMusic])
  const shown = useMemo(() => sortTracks(filterTracks(music.kept, query, filter), sort, { stats: plays, seed }), [music, query, filter, sort, plays, seed])

  return (
    <>
      <PageHeader kicker={[tr('Library'), trn(stats.sources, '{n} source', '{n} sources'), stats.total && tr('{pct}% linked', { pct: stats.linkedPct })].filter(Boolean).join(' · ')} title={tr('Songs')} actions={<PlayAll tracks={shown} />} />
      <div className="flex shrink-0 items-center justify-between gap-4 pb-3.5">
        <SourceChips tracks={tracks} value={filter} onChange={setFilter} />
        <SortMenu />
      </div>
      <Playability tracks={shown} />
      <NotMusicNotice hidden={music.hidden} />
      <TrackTable
        tracks={shown}
        empty={
          tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-base text-ink">{tr('Your library is empty')}</p>
              <p>{tr('Import your YouTube Music playlists: sign in with Google in Accounts, they come in on their own.')}</p>
              <Button onClick={() => go({ name: 'settings', section: 'sources' })}>{tr('Import from YouTube Music')}</Button>
              <p className="text-xs">{tr('Or add a music folder in Accounts, paste a YouTube or Spotify playlist link (Ctrl+V), or search in Add music.')}</p>
            </div>
          ) : (
            tr('No matching songs.')
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
      <button onClick={() => setDraft(name)} title={tr('Rename')} className="truncate text-left hover:underline hover:decoration-line">
        {name}
      </button>
    )
  const save = () => {
    if (draft.trim() && draft.trim() !== name) void editPlaylist({ type: 'rename', id, name: draft })
    setDraft(null)
  }
  return <input autoFocus value={draft} maxLength={100} aria-label={tr('Playlist name')} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && setDraft(null))} className="w-full bg-transparent outline-none" />
}

export function PlaylistView({ id }: { id: number }) {
  const { playlists, playlistTracks, query, editPlaylist, go, playlistSort, stats, seed, showNotMusic } = useStore()
  const playlist = playlists.find((p) => p.id === id)
  const newestFirst = playlist?.newestFirst ?? false
  // Your own playlists show what you put in them; imports set non-music aside.
  const music = useMemo(() => musicOnly(playlistTracks, showNotMusic || !!playlist?.custom), [playlistTracks, showNotMusic, playlist?.custom])
  const shown = useMemo(() => sortTracks(filterTracks(music.kept, query, 'all'), playlistSort, { stats, seed, positional: true, newestFirst }), [music, query, playlistSort, stats, seed, newestFirst])
  const sharing = useStore((s) => s.sharing === id)
  const closeShare = useCallback(() => useStore.setState({ sharing: null }), [])
  if (!playlist) return null
  const duplicate = async () => {
    const copy = await editPlaylist({ type: 'duplicate', id, name: tr('{name} (copy)', { name: playlist.name }) })
    if (copy !== null) go({ name: 'playlist', id: copy })
  }
  return (
    <>
      <PageHeader
        onContextMenu={onMenu(() => playlistMenu(playlist))}
        art={<PlaylistCover p={playlist} size={150} big />}
        kicker={playlist.custom ? tr('Custom playlist') : tr('Playlist · {source} · imported', { source: tr(sourceLabel[playlist.source]) })}
        title={playlist.custom ? <EditableTitle key={playlist.name} id={id} name={playlist.name} /> : playlist.name}
        sub={<span className="font-mono text-[0.6875rem] tracking-[0.06em] uppercase">{trn(playlist.trackCount, '{n} track', '{n} tracks')} · {totalTime(playlistTracks)}</span>}
        actions={
          <>
            <PlayAll tracks={shown} />
            <RoundButton label={tr('Share playlist')} onClick={() => useStore.setState({ sharing: id })} disabled={!playlistTracks.length}>
              <ShareNetwork size={16} />
            </RoundButton>
            {!(playlist.source === 'youtube' && !playlist.custom) && playlistTracks.length > 0 && <ExportYoutube id={id} />}
            <RoundButton label={playlist.custom ? tr('Duplicate') : tr('Duplicate as custom playlist')} onClick={duplicate}>
              <Copy size={16} />
            </RoundButton>
            {playlist.custom && (
              <RoundButton
                label={tr('Delete playlist')}
                onClick={async () => {
                  if (!(await ask({ title: tr('Delete “{name}”?', { name: playlist.name }), body: tr('The songs stay in your library.'), ok: tr('Delete') }))) return
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
      {!playlist.custom && <NotMusicNotice hidden={music.hidden} />}
      {sharing && <SharePanel id={id} name={playlist.name} onClose={closeShare} />}
      <TrackTable tracks={shown} empty={playlist.custom ? tr('Empty playlist: add songs from Songs with the “Add to playlist” button.') : tr('No songs.')} editId={playlist.custom && !query && playlistSort === 'manual' ? id : undefined} />
    </>
  )
}

export function AlbumsView() {
  const { tracks, query, go, albumView: v, stats, seed } = useStore()
  const all = useMemo(() => tracks.filter((t) => t.album), [tracks])
  const albums = useMemo(() => orderGroups(groupAlbums(filterTracks(all, query, v.filter)).map((g) => ({ ...g, name: g.album })), v.sort, { size: v.size, stats, seed }), [all, query, v, stats, seed])
  return (
    <>
      <PageHeader kicker={tr('Library')} title={tr('Albums')} sub={trn(albums.length, '{n} album', '{n} albums')} />
      <GroupBar page="albumView" tracks={all} />
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {albums.length === 0 ? (
          <p className="py-10 text-center text-ink-2">{all.length ? tr('No matching albums.') : tr('No albums yet.')}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-6">
            {albums.map((a) => (
              <li key={`${a.album}-${a.artist}`} onContextMenu={onMenu(() => tracksMenu(a.tracks, ['-', { label: tr('Go to artist'), onSelect: () => go({ name: 'artist', artist: a.artist }) }]))}>
                <button onClick={() => go({ name: 'album', album: a.album, artist: a.artist })} className="group flex w-full flex-col gap-2 text-left">
                  <span className="relative aspect-square w-full">
                    <Cover title={a.album} art={firstArt(a.tracks)} size={150} className="size-full! text-[1.75rem]!" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.8125rem] font-semibold group-hover:underline">{a.album}</span>
                    <span className="block truncate text-xs text-ink-2">
                      {a.artist} · {trn(a.tracks.length, '{n} track', '{n} tracks')}
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
      <PageHeader onContextMenu={onMenu(() => tracksMenu(shown, ['-', { label: tr('Go to artist'), onSelect: () => useStore.getState().go({ name: 'artist', artist }) }]))} art={<Cover title={album} art={firstArt(shown)} size={150} />} kicker={tr('Album · {artist}', { artist })} title={album} sub={<span className="font-mono text-[0.6875rem] tracking-[0.06em] uppercase">{trn(shown.length, '{n} track', '{n} tracks')} · {totalTime(shown)}</span>} actions={<PlayAll tracks={shown} />} />
      <TrackTable tracks={shown} empty={tr('No songs.')} />
    </>
  )
}

export function ArtistsView() {
  const { tracks, query, go, artistView: v, stats, seed } = useStore()
  const artists = useMemo(() => orderGroups(groupArtists(filterTracks(tracks, query, v.filter)).map((g) => ({ ...g, name: g.artist })), v.sort, { size: v.size, stats, seed }), [tracks, query, v, stats, seed])
  return (
    <>
      <PageHeader kicker={tr('Library')} title={tr('Artists')} sub={trn(artists.length, '{n} artist', '{n} artists')} />
      <GroupBar page="artistView" tracks={tracks} />
      <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {artists.length === 0 && <p className="py-10 text-center text-ink-2">{tr('No matching artists.')}</p>}
        {artists.map((a, i) => (
          <li key={a.artist} onContextMenu={onMenu(() => tracksMenu(a.tracks))}>
            <button onClick={() => go({ name: 'artist', artist: a.artist })} className="flex w-full items-center gap-4 border-b border-line-soft px-2 py-2.5 text-left hover:bg-raised">
              <span className="w-8 text-right font-mono text-[0.6875rem] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              <Cover title={a.artist} art={trackArt(a.cover)} size={36} className="rounded-full!" />
              <span className="flex-1 truncate text-[0.8125rem] font-semibold">{a.artist}</span>
              <span className="font-mono text-[0.625rem] tracking-[0.06em] text-ink-3 uppercase">
                {trn(a.count, '{n} track', '{n} tracks')} · {trn(a.albums, '{n} album', '{n} albums')}
                {v.sort === 'most-played' && ` · ${trn(groupStats(a, stats).plays, '{n} play', '{n} plays')}`}
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
      <PageHeader onContextMenu={onMenu(() => tracksMenu(shown))} art={<Cover title={artist} art={firstArt(shown)} size={120} className="rounded-full!" />} kicker={tr('Artist')} title={artist} sub={<span className="font-mono text-[0.6875rem] tracking-[0.06em] uppercase">{trn(shown.length, '{n} track', '{n} tracks')} · {totalTime(shown)}</span>} actions={<PlayAll tracks={shown} />} />
      <TrackTable tracks={shown} empty={tr('No songs.')} />
    </>
  )
}

import { CaretDown, Columns, DotsThree, Info, MagnifyingGlass, Play, Plus, ShareNetwork, Shuffle, SortAscending } from '@phosphor-icons/react'
import { useCallback, useMemo, useState } from 'react'
import { useSettings } from '../../app/settings'
import { pageQuery, useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, LedChip, RoundButton, Segmented } from '../../shared/ui/controls'
import { VirtualGrid } from '../../shared/ui/VirtualGrid'
import { VirtualList } from '../../shared/ui/VirtualList'
import { firstArt, trackArt } from '../../shared/art'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { playlistMenu, shufflePlay, tracksMenu } from '../menus'
import { PageHeader } from '../../shared/ui/PageHeader'
import { sourceLabel } from '../../shared/ui/SourceIcon'
import { isFull, vias } from '../player/sources'
import { usePlayer } from '../player/store'
import { SharePanel } from '../share/SharePanel'
import { FIT_FIELD, SongsThatFit } from './SongsThatFit'
import { PlaylistCover } from './PlaylistCover'
import { COLUMNS, type Column } from '../../shared/theme/theme'
import { filterTracks, groupAlbums, groupArtists, groupStats, libraryStats, musicOnly, sortGroups as orderGroups, sortTracks, type Filter, type GroupSort, type Sort } from './filter'
import { DuplicatesButton } from './DuplicatesDialog'
import { HiddenVideos } from './HiddenVideos'
import { TrackTable } from './TrackTable'
import { msg, tr, trn } from '../../shared/i18n/i18n'

/** YouTube-like sort list, in groups. Manual only on playlists. */
const sortGroups: { id: Sort; label: string }[][] = [
  [{ id: 'manual', label: msg('Your order') }],
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

export const totalTime = (tracks: LibraryTrack[]) => {
  const min = Math.round(tracks.reduce((s, t) => s + (t.durationMs ?? 0), 0) / 60_000)
  return min >= 60 ? tr('{h} hr {m} min', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') }) : tr('{m} min', { m: min })
}

/** Play and Shuffle in words (list pages): the first playable song, or any. Absent if none plays. */
function PlayPills({ tracks }: { tracks: LibraryTrack[] }) {
  const play = usePlayer((s) => s.playTracks)
  const sp = useStore((s) => s.status.spotify.connected)
  const first = tracks.findIndex((t) => vias(t, sp).length > 0)
  if (first < 0) return null
  return (
    <>
      <Button variant="accent" onClick={() => play(tracks, first)}>
        <Play weight="fill" size={14} /> {tr('Play')}
      </Button>
      <Button variant="ghost" onClick={() => shufflePlay(tracks)}>
        <Shuffle size={14} /> {tr('Shuffle')}
      </Button>
    </>
  )
}

/** Shuffle next to a page's round Play (album, artist, playlist). */
export function ShuffleRound({ tracks }: { tracks: LibraryTrack[] }) {
  if (!tracks.length) return null
  return (
    <RoundButton label={tr('Shuffle play')} onClick={() => shufflePlay(tracks)}>
      <Shuffle size={18} />
    </RoundButton>
  )
}

const columnLabels: Record<Column, string> = { album: msg('Album'), sources: msg('Sources'), plays: msg('Plays'), duration: msg('Duration') }

/** Which list columns show (settings columns, also in Appearance). */
function ColumnsButton() {
  const columns = useSettings((s) => s.settings.columns)
  const toggle = (c: Column) => useSettings.getState().update({ columns: columns.includes(c) ? columns.filter((x) => x !== c) : COLUMNS.filter((x) => x === c || columns.includes(x)) })
  return (
    <RoundButton label={tr('Columns')} kind="plain" size="sm" onClick={(e) => openMenu(e, COLUMNS.map((c) => ({ label: tr(columnLabels[c]), checked: columns.includes(c), onSelect: () => toggle(c) })))}>
      <Columns size={16} />
    </RoundButton>
  )
}

/** Round play button: starts first playable track of the list. Absent if none. */
export function PlayAll({ tracks }: { tracks: LibraryTrack[] }) {
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
      className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-raised"
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

/** Source chips with counts, for a list of songs. countOf: what the page counts (albums, artists), songs by default. */
function SourceChips({ tracks, value, onChange, countOf }: { tracks: LibraryTrack[]; value: Filter; onChange: (f: Filter) => void; countOf?: (tracks: LibraryTrack[]) => number }) {
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const count = useMemo(() => (f: Filter, songs: number) => (countOf ? countOf(filterTracks(tracks, '', f)) : songs), [tracks, countOf])
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: msg('All'), count: count('all', stats.total) },
    ...(['youtube', 'spotify', 'apple', 'local'] as const).filter((s) => stats.perSource[s]).map((s) => ({ id: s, label: sourceLabel[s], count: count(s, stats.perSource[s]) })),
    ...(stats.sources > 1 && stats.unlinked ? [{ id: 'unlinked' as const, label: msg('Unlinked'), count: count('unlinked', stats.unlinked) }] : []),
  ]
  return (
    <div role="tablist" aria-label={tr('Filter by source')} className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <LedChip key={c.id} on={value === c.id} label={tr(c.label)} count={formatCount(c.count)} onClick={() => onChange(c.id)} />
      ))}
    </div>
  )
}

const countAlbums = (t: LibraryTrack[]) => groupAlbums(t).length
const countArtists = (t: LibraryTrack[]) => groupArtists(t).length

/** Albums / Artists bar: source chips (counting albums or artists), how many songs you have of it, sort. */
function GroupBar({ page, tracks }: { page: 'albumView' | 'artistView'; tracks: LibraryTrack[] }) {
  const v = useStore((s) => s[page])
  const setGroupView = useStore((s) => s.setGroupView)
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3.5">
      <SourceChips tracks={tracks} value={v.filter} onChange={(filter) => setGroupView(page, { filter })} countOf={page === 'albumView' ? countAlbums : countArtists} />
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

/** What plays in full, what only previews, what can't play: a pill in the toolbar, the detail on click. */
function Playability({ tracks }: { tracks: LibraryTrack[] }) {
  const sp = useStore((s) => s.status.spotify.connected)
  const [open, setOpen] = useState(false)
  const full = tracks.filter((t) => isFull(t, sp)).length
  const missing = tracks.filter((t) => !isFull(t, sp))
  const preview = missing.filter((t) => vias(t, sp).length > 0).length
  if (!tracks.length) return null
  const parts = [trn(full, '{n} song playable in full', '{n} songs playable in full'), preview > 0 && trn(preview, '{n} as 30 s preview', '{n} as 30 s preview'), missing.length > preview && trn(missing.length - preview, '{n} with no playable source', '{n} with no playable source')].filter((x): x is string => !!x)
  return (
    <span className="relative">
      <button aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full bg-raised px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
        <Led on={missing.length === 0} /> {parts[0]}
        {parts.length > 1 && ` · ${parts.length - 1 === 1 ? parts[1] : `+${formatCount(missing.length)}`}`}
        <Info size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+6px)] right-0 z-50 flex w-80 flex-col gap-2 rounded-xl border border-line bg-panel p-3.5 text-xs shadow-[0_12px_32px_var(--shadow)]">
            {parts.map((p, i) => (
              <span key={p} className="flex items-center gap-2">
                <Led on={i === 0} /> {p}
              </span>
            ))}
            <span className="text-ink-2">{tr('Local file first, then the official YouTube player, then the Apple Music preview.')}</span>
            <FindVersions tracks={missing} />
          </div>
        </>
      )}
    </span>
  )
}

export function SongsView() {
  const { tracks, filter, setFilter, sort, setSort, go, stats: plays, seed } = useStore()
  const query = useStore(pageQuery)
  const stats = useMemo(() => libraryStats(tracks), [tracks])
  const music = useMemo(() => musicOnly(tracks), [tracks])
  // The fold follows the search and the source chips too.
  const hidden = useMemo(() => filterTracks(music.hidden, query, filter), [music, query, filter])
  const shown = useMemo(() => sortTracks(filterTracks(music.kept, query, filter), sort, { stats: plays, seed }), [music, query, filter, sort, plays, seed])

  return (
    <>
      <PageHeader title={tr('Songs')} sub={`${trn(shown.length, '{n} song', '{n} songs')} · ${totalTime(shown)}${stats.sources > 1 ? ` · ${tr('{pct}% linked', { pct: stats.linkedPct })}` : ''}`} actions={<PlayPills tracks={shown} />} />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <SourceChips tracks={tracks} value={filter} onChange={setFilter} />
        <div className="flex items-center gap-2">
          <DuplicatesButton />
          <Playability tracks={shown} />
          <SortMenu />
          <ColumnsButton />
        </div>
      </div>
      <HiddenVideos tracks={hidden} />
      <TrackTable
        tracks={shown}
        sort={sort}
        onSort={setSort}
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
  const { playlists, playlistTracks, playlistSort, setPlaylistSort, stats, seed } = useStore()
  const query = useStore(pageQuery)
  const playlist = playlists.find((p) => p.id === id)
  const newestFirst = playlist?.newestFirst ?? false
  // Your own playlists show what you put in them; imports set non-music aside.
  const music = useMemo(() => (playlist?.custom ? { kept: playlistTracks, hidden: [] } : musicOnly(playlistTracks)), [playlistTracks, playlist?.custom])
  const hidden = useMemo(() => filterTracks(music.hidden, query, 'all'), [music, query])
  const shown = useMemo(() => sortTracks(filterTracks(music.kept, query, 'all'), playlistSort, { stats, seed, positional: true, newestFirst }), [music, query, playlistSort, stats, seed, newestFirst])
  const sharing = useStore((s) => s.sharing === id)
  const closeShare = useCallback(() => useStore.setState({ sharing: null }), [])
  if (!playlist) return null
  // Add songs: to the panel under the list, its field ready.
  const addSongs = () => {
    const field = document.getElementById(FIT_FIELD)
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    field?.focus({ preventScroll: true })
  }
  return (
    <>
      <PageHeader
        onContextMenu={onMenu(() => playlistMenu(playlist))}
        art={<PlaylistCover p={playlist} size={184} big />}
        kicker={playlist.custom ? tr('Your playlist') : tr('Playlist · {source} · imported', { source: tr(sourceLabel[playlist.source]) })}
        title={playlist.custom ? <EditableTitle key={playlist.name} id={id} name={playlist.name} /> : playlist.name}
        sub={`${trn(playlist.trackCount, '{n} song', '{n} songs')} · ${totalTime(playlistTracks)}`}
        actions={
          <>
            <PlayAll tracks={shown} />
            <ShuffleRound tracks={shown} />
            {playlist.custom && (
              <Button variant="ghost" onClick={addSongs}>
                <Plus size={15} /> {tr('Add songs')}
              </Button>
            )}
            <RoundButton label={tr('Share playlist')} onClick={() => useStore.setState({ sharing: id })} disabled={!playlistTracks.length}>
              <ShareNetwork size={17} />
            </RoundButton>
            {/* Export, duplicate, rename, delete: the playlist's own menu, as on a right-click. */}
            <RoundButton label={tr('More')} kind="plain" onClick={(e) => openMenu(e, playlistMenu(playlist))}>
              <DotsThree size={20} weight="bold" />
            </RoundButton>
          </>
        }
      />
      <div className="flex shrink-0 items-center justify-end gap-2 pb-3">
        <Playability tracks={playlistTracks} />
        <SortMenu playlist />
        <ColumnsButton />
      </div>
      <HiddenVideos tracks={hidden} />
      {sharing && <SharePanel id={id} name={playlist.name} onClose={closeShare} />}
      <TrackTable tracks={shown} sort={playlistSort} onSort={setPlaylistSort} empty={playlist.custom ? tr('Empty playlist: add songs below, or from Songs with the “Add to playlist” button.') : tr('No songs.')} editId={playlist.custom && !query && playlistSort === 'manual' ? id : undefined} footer={playlist.custom && <SongsThatFit id={id} songs={playlistTracks} />} />
    </>
  )
}

export function AlbumsView() {
  const { tracks, go, albumView: v, stats, seed } = useStore()
  const query = useStore(pageQuery)
  const all = useMemo(() => tracks.filter((t) => t.album), [tracks])
  const albums = useMemo(() => orderGroups(groupAlbums(filterTracks(all, query, v.filter)).map((g) => ({ ...g, name: g.album })), v.sort, { size: v.size, stats, seed }), [all, query, v, stats, seed])
  return (
    <>
      <PageHeader kicker={tr('Library')} title={tr('Albums')} sub={trn(albums.length, '{n} album', '{n} albums')} />
      <GroupBar page="albumView" tracks={all} />
      {albums.length === 0 ? (
        <p className="py-10 text-center text-ink-2">{all.length ? tr('No matching albums.') : tr('No albums yet.')}</p>
      ) : (
        <VirtualGrid
          items={albums}
          itemKey={(a) => `${a.album}\u0000${a.artist}`}
          className="-mx-2 px-2 pb-6"
          render={(a) => (
            <button onClick={() => go({ name: 'album', album: a.album, artist: a.artist })} onContextMenu={onMenu(() => tracksMenu(a.tracks, ['-', { label: tr('Go to artist'), onSelect: () => go({ name: 'artist', artist: a.artist }) }]))} className="group flex w-full flex-col gap-2 text-left">
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
          )}
        />
      )}
    </>
  )
}

export function ArtistsView() {
  const { tracks, go, artistView: v, stats, seed } = useStore()
  const query = useStore(pageQuery)
  const artists = useMemo(() => orderGroups(groupArtists(filterTracks(tracks, query, v.filter)).map((g) => ({ ...g, name: g.artist })), v.sort, { size: v.size, stats, seed }), [tracks, query, v, stats, seed])
  return (
    <>
      <PageHeader kicker={tr('Library')} title={tr('Artists')} sub={trn(artists.length, '{n} artist', '{n} artists')} />
      <GroupBar page="artistView" tracks={tracks} />
      {artists.length === 0 && <p className="py-10 text-center text-ink-2">{tr('No matching artists.')}</p>}
      <VirtualList items={artists} rowHeight={57} className="-mx-2 px-2 pb-6">
        {(a, i) => (
          <div role="listitem" key={a.artist} onContextMenu={onMenu(() => tracksMenu(a.tracks))} className="h-full">
            <button onClick={() => go({ name: 'artist', artist: a.artist })} className="flex h-full w-full items-center gap-4 border-b border-line-soft px-2 text-left hover:bg-raised">
              <span className="w-8 text-right font-mono text-[0.6875rem] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
              <Cover title={a.artist} art={trackArt(a.cover)} size={36} className="rounded-full!" />
              <span className="flex-1 truncate text-[0.8125rem] font-semibold">{a.artist}</span>
              <span className="font-mono text-[0.625rem] tracking-[0.06em] text-ink-3 uppercase">
                {trn(a.count, '{n} track', '{n} tracks')} · {trn(a.albums, '{n} album', '{n} albums')}
                {v.sort === 'most-played' && ` · ${trn(groupStats(a, stats).plays, '{n} play', '{n} plays')}`}
              </span>
            </button>
          </div>
        )}
      </VirtualList>
    </>
  )
}

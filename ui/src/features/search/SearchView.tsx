import { ArrowLeft, FolderSimple, Play, Plus, Shuffle } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type Origin, type SearchHit, type SearchResults, type Track } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatCount, formatDuration, region, spotifyList } from '../../shared/format'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { LedChip, RoundButton, Toggle } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { CardRow, MediaCard, Section } from '../../shared/ui/Section'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { kindLabel, unofficial, videoKind } from '../add/kind'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { groupAlbums, groupArtists, type AlbumGroup, type ArtistGroup } from '../library/filter'
import { HiddenFold } from '../library/HiddenVideos'
import { PlaylistCover } from '../library/PlaylistCover'
import { TrackTable } from '../library/TrackTable'
import { hitMenu, playlistMenu, trackMenu, tracksMenu } from '../menus'
import { remoteTrack, usePlayer } from '../player/store'
import { addRecent } from './recent'
import { countBy, errorOf, isSong, isVideo, libraryMatches, type Kind, type LibraryMatches, type Scope } from './results'

const order = ['youtube', 'apple', 'spotify', 'local'] as const
/** Rows and cards a section shows before its See all. */
const FEW = 5
const ROW = 6
/** Card grids (Albums, Artists, Playlists tabs): past this, the library page takes over. */
const MANY = 120

function Badge({ children }: { children: string }) {
  return <span className="rounded-[3px] border border-line px-1.5 font-mono text-[0.625rem] tracking-[0.08em] text-ink-3">{children}</span>
}

/** The catalog track of a hit (no UI fields). */
const trackOf = (h: SearchHit): Track => ({ title: h.title, artist: h.artist, album: h.album, durationMs: h.durationMs, isrc: h.isrc, ids: h.ids, art: h.art })

/**
 * Media/SongRow (56 px): cover that plays on a click, title over artist · album, where it comes from, time, then
 * `right` (add, or in your library). Double-click plays too.
 */
function ResultRow({ title, sub, art, badges, sources, ms, onPlay, menu, right }: { title: string; sub: string; art: ReactNode; badges?: ReactNode; sources: ReactNode; ms: number | null; onPlay: () => void; menu: () => ReturnType<typeof tracksMenu>; right: ReactNode }) {
  return (
    <li onContextMenu={onMenu(menu)} onDoubleClick={onPlay} className="group flex h-14 items-center gap-4 rounded-md px-4 transition-colors hover:bg-raised">
      <button aria-label={tr('Play {title}', { title })} title={tr('Play {title}', { title })} onClick={onPlay} className="relative shrink-0">
        {art}
        <span aria-hidden className="absolute inset-0 grid place-items-center rounded-cover bg-black/45 text-white opacity-0 group-hover:opacity-100">
          <Play weight="fill" size={16} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {title} {badges}
        </p>
        <p className="truncate text-[0.8125rem] text-ink-2">{sub}</p>
      </div>
      <span className="flex items-center gap-2 text-ink-3">{sources}</span>
      <span className="w-11 text-right text-sm text-ink-3 tabular-nums">{formatDuration(ms)}</span>
      {right}
    </li>
  )
}

/** Where the add button would be: the folder of the mockup's "In your library". */
const InLibrary = () => (
  <span role="img" aria-label={tr('Already in your library')} title={tr('Already in your library')} className="grid size-8 shrink-0 place-items-center text-ink-3">
    <FolderSimple size={16} />
  </span>
)

function HitRow({ hit, onAdded, onPlay, extra }: { hit: SearchHit; onAdded: (id: number) => void; onPlay: () => void; extra?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const kind = hit.ids.youtube && !hit.ids.apple ? videoKind(hit.title) : null
  const add = async () => {
    setBusy(true)
    try {
      onAdded(await api.addTrack(trackOf(hit)))
      await useStore.getState().refreshChanged()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <ResultRow
      title={hit.title}
      sub={[hit.artist, hit.album].filter(Boolean).join(' · ')}
      art={<Cover title={hit.album ?? hit.title} art={trackArt({ ...hit, id: hit.libraryId ?? undefined })} size={40} />}
      badges={
        <>
          {kind && <Badge>{tr(kindLabel[kind])}</Badge>}
          {hit.musicness === 'notMusic' && <Badge>{tr('NOT MUSIC?')}</Badge>}
        </>
      }
      sources={order.filter((s) => hit.ids[s]).map((s) => (
        <SourceIcon key={s} source={s} size={13} />
      ))}
      ms={hit.durationMs}
      onPlay={onPlay}
      menu={() => hitMenu(hit, add, busy, onPlay)}
      right={
        <>
          {extra}
          {hit.libraryId ? (
            <InLibrary />
          ) : (
            <RoundButton label={tr('Add {title}', { title: hit.title })} kind="soft" size="sm" disabled={busy} onClick={add}>
              <Plus size={14} />
            </RoundButton>
          )}
        </>
      }
    />
  )
}

/** A library song among the results: plays the matching songs from there. */
function LibraryRow({ list, i }: { list: LibraryTrack[]; i: number }) {
  const t = list[i]
  return (
    <ResultRow
      title={t.title}
      sub={[t.artist, t.album].filter(Boolean).join(' · ')}
      art={<Cover title={t.album ?? t.title} art={trackArt(t)} size={40} />}
      sources={order.filter((s) => t.ids[s]).map((s) => (
        <SourceIcon key={s} source={s} size={13} />
      ))}
      ms={t.durationMs}
      onPlay={() => usePlayer.getState().playTracks(list, i)}
      menu={() => trackMenu(t, { list, index: i })}
      right={<InLibrary />}
    />
  )
}

/** YouTube result as a 16:9 card (thumbnails are 4:3 with bars: the crop drops them); grey on hover like Media/Card. */
function VideoCard({ hit, onPlay, onAdded }: { hit: SearchHit; onPlay: () => void; onAdded: (id: number) => void }) {
  const src = trackArt({ ...hit, id: hit.libraryId ?? undefined })[0]
  const add = () => void api.addTrack(trackOf(hit)).then(async (id) => (onAdded(id), await useStore.getState().refreshChanged()), (e) => useStore.setState({ error: String(e) }))
  return (
    <li onContextMenu={onMenu(() => hitMenu(hit, add, false, onPlay))} className="min-w-0">
      <button onClick={onPlay} className="flex w-full flex-col gap-2.5 rounded-lg p-3 text-left transition-colors hover:bg-raised">
        <span className="relative block aspect-video overflow-hidden rounded-cover border border-line-soft bg-recess">
          {src && <img src={src} alt="" loading="lazy" crossOrigin="anonymous" className="size-full object-cover" />}
          {hit.durationMs && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 text-[0.6875rem] text-white tabular-nums">{formatDuration(hit.durationMs)}</span>}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium">{hit.title}</span>
          <span className="truncate text-[0.8125rem] text-ink-3">{hit.artist}</span>
        </span>
      </button>
    </li>
  )
}

/** Titles of the views behind each section's Show all. */
const KINDS: Record<Exclude<Kind, 'all'>, string> = { songs: msg('Songs'), videos: msg('Videos'), albums: msg('Albums'), artists: msg('Artists'), playlists: msg('Playlists') }

/** Search page chips (mockup): everything, your library alone, or one catalog. */
type From = 'all' | 'library' | Origin
const NONE: LibraryMatches = { songs: [], artists: [], albums: [], playlists: [] }

/**
 * Results of the top bar's search (the only search field): your library and the catalogs (YouTube, YouTube Music,
 * Apple Music), by type. Your library alone = no network. The line under the tabs says which services answered.
 */
export function SearchView() {
  const request = useStore((s) => s.search)
  const { tracks, playlists, status, go } = useStore(useShallow(({ tracks, playlists, status, go }) => ({ tracks, playlists, status, go })))
  const play = usePlayer((s) => s.playTracks)
  const rememberSearches = useSettings((s) => s.settings.rememberSearches)
  const q = request?.q ?? ''
  const [scope, setScope] = useState<Scope>('everywhere')
  const [kind, setKind] = useState<Kind>('all')
  const [only, setOnly] = useState<Origin | null>(null)
  const [hideCovers, setHideCovers] = useState(true)
  const [res, setRes] = useState<{ q: string; r: SearchResults }>()
  const [busy, setBusy] = useState(false)
  // Videos that clearly aren't music: their own fold, folded again on each search.
  const [round, setRound] = useState(0)
  const ytOn = status.youtube.connected
  const everywhere = scope === 'everywhere'

  // Latest search only: a slow answer for the previous text must not land.
  const latest = useRef(0)
  const run = async (text: string) => {
    const mine = ++latest.current
    setBusy(true)
    try {
      const r = await api.searchCatalogs(text, region())
      if (mine !== latest.current) return
      setRes({ q: text, r })
      setRound((n) => n + 1)
    } catch (err) {
      if (mine === latest.current) useStore.setState({ error: String(err) })
    } finally {
      if (mine === latest.current) setBusy(false)
    }
  }

  // Music Detector's song: the matching catalog hit once the search for it is back (same ISRC or Apple id), else itself.
  const [found, setFound] = useState<SearchHit | null>(null)
  useEffect(() => {
    if (!request) return
    setKind('all')
    setOnly(null)
    const t = request.found
    const inLibrary = t && tracks.find((x) => (t.isrc && x.isrc === t.isrc) || (t.ids.apple && x.ids.apple === t.ids.apple))
    setFound(t ? { ...t, libraryId: inLibrary?.id ?? null, musicness: 'music', from: [] } : null)
    if (spotifyList(request.q)) return void useStore.getState().importSpotify(request.q.trim())
    // A song named by the Music Detector isn't something you typed.
    if (rememberSearches && !t) addRecent(request.q)
    if (everywhere) void run(request.q)
  }, [request?.n]) // once per ask
  // Back to Everywhere after Your library: the catalogs for this text, once.
  const switched = useRef(false)
  useEffect(() => {
    if (!switched.current) return void (switched.current = true)
    if (everywhere && q && res?.q !== q && !spotifyList(q)) void run(q)
  }, [scope])

  const groups = useMemo(() => ({ artists: groupArtists(tracks), albums: groupAlbums(tracks) }), [tracks])
  const lib = useMemo(() => libraryMatches(tracks, playlists, q, groups), [tracks, playlists, q, groups])
  const results = res?.q === q ? res.r : undefined
  const kept = (results?.hits ?? []).filter((h) => (!only || h.from.includes(only)) && !(hideCovers && h.ids.youtube && !h.ids.apple && unofficial(videoKind(h.title))))
  const music = kept.filter((h) => h.musicness !== 'notMusic')
  const others = kept.filter((h) => h.musicness === 'notMusic')
  const songs = music.filter(isSong)
  const videos = music.filter(isVideo)
  const counts = countBy(results?.hits ?? [])

  const identified = useMemo(() => {
    if (!found) return null
    const same = (h: SearchHit) => (found.isrc && h.isrc === found.isrc) || (found.ids.apple && h.ids.apple === found.ids.apple)
    const hit = results?.hits.find(same)
    return hit ? { ...hit, libraryId: hit.libraryId ?? found.libraryId } : found
  }, [found, results])
  const playOne = async (h: SearchHit) => {
    const own = tracks.find((t) => t.id === h.libraryId)
    play([own ?? remoteTrack(h.ids.youtube ? trackOf(h) : await api.resolveTrack(trackOf(h)).catch(() => trackOf(h)))], 0)
  }
  // Library id of the identified song, added on the way when needed (Add to playlist).
  const identifiedIds = async () => {
    if (identified?.libraryId) return [identified.libraryId]
    const id = await api.addTrack(trackOf(identified!))
    setFound((f) => f && { ...f, libraryId: id })
    await useStore.getState().refreshChanged()
    return [id]
  }

  // Results play as a queue, added or not (session-only items, like Home's recommendations). A hit with no YouTube
  // version gets one first (one search, nothing written) so it plays in full.
  const playHit = async (h: SearchHit, list: SearchHit[]) => {
    const queue = list.map((x) => tracks.find((t) => t.id === x.libraryId) ?? remoteTrack(trackOf(x)))
    const i = list.indexOf(h)
    if (!h.libraryId && !h.ids.youtube) queue[i] = remoteTrack(await api.resolveTrack(trackOf(h)).catch(() => trackOf(h)))
    play(queue, i)
  }
  const markAdded = (h: SearchHit, libraryId: number) => setRes((r) => r && { ...r, r: { ...r.r, hits: r.r.hits.map((x) => (x === h ? { ...x, libraryId } : x)) } })
  const hitRows = (list: SearchHit[]) => list.map((h) => <HitRow key={Object.values(h.ids).join('|')} hit={h} onAdded={(id) => markAdded(h, id)} onPlay={() => void playHit(h, list)} />)

  // A catalog's chip shows that catalog alone: your library's matches step aside.
  const mine = only ? NONE : lib
  const artistCard = (a: ArtistGroup) => <MediaCard key={a.artist} round title={a.artist} sub={trn(a.count, '{n} song', '{n} songs')} art={<Cover title={a.artist} art={trackArt(a.cover)} size={176} className="rounded-full!" />} onOpen={() => go({ name: 'artist', artist: a.artist })} onPlay={() => play(a.tracks, 0)} menu={() => tracksMenu(a.tracks)} />
  const albumCard = (a: AlbumGroup) => <MediaCard key={`${a.album}\u0000${a.artist}`} title={a.album} sub={a.artist} art={<Cover title={a.album} art={trackArt(a.tracks[0])} size={176} />} onOpen={() => go({ name: 'album', album: a.album, artist: a.artist })} onPlay={() => play(a.tracks, 0)} menu={() => tracksMenu(a.tracks)} />
  const playlistCards = mine.playlists.map((p) => <MediaCard key={p.id} title={p.name} sub={trn(p.trackCount, '{n} song', '{n} songs')} art={<PlaylistCover p={p} size={176} big />} onOpen={() => go({ name: 'playlist', id: p.id })} onPlay={() => void api.playlistTracks(p.id).then((t) => play(t, 0))} menu={() => playlistMenu(p)} />)
  // Library page filtered by the same text (its own token on).
  const openPage = (name: 'songs' | 'albums' | 'artists') => {
    go({ name })
    useStore.getState().setQuery(q)
  }
  const tooMany = (n: number, name: 'albums' | 'artists') =>
    n > MANY && (
      <button onClick={() => openPage(name)} className="mt-4 text-sm font-medium text-ink-2 hover:text-ink">
        {tr('See all {n} in {page}', { n: formatCount(n), page: tr(name === 'albums' ? 'Albums' : 'Artists') })}
      </button>
    )

  // Top result (mockup): an artist of yours, else the first song; cover, name in Display M, "In your library", play.
  const topArtist = mine.artists[0]
  const topSong = !topArtist ? (mine.songs[0] ?? null) : null
  const topHit = !topArtist && !topSong ? (songs[0] ?? videos[0] ?? null) : null
  const display = 'truncate text-left text-[2rem] leading-[2.375rem] font-bold tracking-[-0.01em]'
  const topCard = (cover: ReactNode, name: ReactNode, line: string, own: boolean, buttons: ReactNode) => (
    <Section title={tr('Top result')} className="w-[300px] shrink-0">
      <div className="flex flex-col gap-3.5 rounded-lg bg-raised p-5">
        {cover}
        <div className="flex min-w-0 flex-col gap-1">
          {name}
          <p className="truncate text-sm text-ink-2">{line}</p>
        </div>
        <div className="flex items-center gap-2">
          {own && (
            <span className="flex items-center gap-2 text-xs font-medium text-ink-2">
              <FolderSimple size={16} /> {tr('In your library')}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">{buttons}</span>
        </div>
      </div>
    </Section>
  )
  const top = topArtist
    ? topCard(
        <Cover title={topArtist.artist} art={trackArt(topArtist.cover)} size={96} className="rounded-full!" />,
        <button onClick={() => go({ name: 'artist', artist: topArtist.artist })} className={`${display} hover:underline`}>
          {topArtist.artist}
        </button>,
        `${tr('Artist')} · ${trn(topArtist.count, '{n} song', '{n} songs')}`,
        true,
        <>
          <RoundButton label={tr('Shuffle play')} onClick={() => (usePlayer.setState({ shuffle: true }), play(topArtist.tracks, Math.floor(Math.random() * topArtist.tracks.length)))}>
            <Shuffle size={16} />
          </RoundButton>
          <RoundButton label={tr('Play {title}', { title: topArtist.artist })} kind="primary" size="lg" onClick={() => play(topArtist.tracks, 0)}>
            <Play size={22} weight="fill" />
          </RoundButton>
        </>,
      )
    : (topSong || topHit) &&
      (() => {
        const t = (topSong ?? topHit)!
        return topCard(
          <Cover title={t.album ?? t.title} art={trackArt(topSong ?? { ...topHit!, id: topHit!.libraryId ?? undefined })} size={96} />,
          <p className={display}>{t.title}</p>,
          `${tr('Song')} · ${t.artist}`,
          !!topSong || !!topHit?.libraryId,
          <RoundButton label={tr('Play {title}', { title: t.title })} kind="primary" size="lg" onClick={() => (topSong ? play(mine.songs, 0) : void playHit(topHit!, songs.length ? songs : videos))}>
            <Play size={22} weight="fill" />
          </RoundButton>,
        )
      })()

  const libSongs = mine.songs.slice(0, everywhere ? 2 : FEW)
  const songsList = (
    <ul className="min-w-0">
      {libSongs.map((t, i) => (
        <LibraryRow key={t.id} list={mine.songs} i={i} />
      ))}
      {everywhere && hitRows(songs.slice(0, FEW - libSongs.length))}
    </ul>
  )
  const anySongs = mine.songs.length > 0 || (everywhere && songs.length > 0)
  const nothing = !busy && !anySongs && !videos.length && !others.length && !mine.artists.length && !mine.albums.length && !mine.playlists.length && !identified

  const all = (
    <div className="flex flex-col gap-8">
      {identified && (
        <Section title={tr('Identified by AudD')}>
          <ul>
            <HitRow hit={identified} onAdded={(id) => setFound((f) => f && { ...f, libraryId: id })} onPlay={() => void playOne(identified)} extra={<AddToPlaylist trackIds={identifiedIds} label={tr('Add {title} to a playlist', { title: identified.title })} />} />
          </ul>
        </Section>
      )}
      {(top || anySongs) && (
        <div className="flex flex-wrap items-start gap-6">
          {top}
          {anySongs && (
            <Section title={tr('Songs')} onAll={() => setKind('songs')} className="min-w-0 flex-1 basis-[22rem]">
              {songsList}
            </Section>
          )}
        </div>
      )}
      {everywhere && videos.length > 0 && (
        <Section title={tr('Videos')} onAll={() => setKind('videos')}>
          {/* One row, as many cards as fit the width (the rest wait behind Show all); their padding is the gap. */}
          <ul className="-mx-3 -mt-2 grid auto-rows-[0] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] grid-rows-[auto] overflow-hidden">
            {videos.slice(0, 8).map((h) => (
              <VideoCard key={Object.values(h.ids).join('|')} hit={h} onPlay={() => void playHit(h, videos)} onAdded={(id) => markAdded(h, id)} />
            ))}
          </ul>
        </Section>
      )}
      {mine.artists.length > 0 && (
        <Section title={tr('Artists')} onAll={() => setKind('artists')}>
          <CardRow>{mine.artists.slice(0, ROW).map(artistCard)}</CardRow>
        </Section>
      )}
      {mine.albums.length > 0 && (
        <Section title={tr('Albums')} onAll={() => setKind('albums')}>
          <CardRow>{mine.albums.slice(0, ROW).map(albumCard)}</CardRow>
        </Section>
      )}
      {mine.playlists.length > 0 && (
        <Section title={tr('Playlists')} onAll={() => setKind('playlists')}>
          <CardRow>{playlistCards.slice(0, ROW)}</CardRow>
        </Section>
      )}
      {everywhere && (
        <HiddenFold key={round} count={others.length}>
          <ul>{hitRows(others)}</ul>
        </HiddenFold>
      )}
    </div>
  )

  const grid = '-mx-3 flex flex-wrap'
  const shown = kind === 'videos' && !everywhere ? 'all' : kind
  const from: From = !everywhere ? 'library' : (only ?? 'all')
  const pickFrom = (f: From) => {
    setScope(f === 'library' ? 'library' : 'everywhere')
    setOnly(f === 'all' || f === 'library' ? null : f)
  }
  // A catalog's chip: its count, or why it's missing (tooltip).
  const chip = (o: Origin, name: string) => {
    const error = results && errorOf(results.errors, o)
    return <LedChip key={o} on={from === o} label={name} title={error} count={error ? tr('Failed') : results ? formatCount(counts[o]) : busy ? '…' : undefined} onClick={() => pickFrom(o)} />
  }

  if (!request)
    return (
      <>
        <PageHeader kicker={tr('Search results')} title={tr('Search')} />
        <p className="py-10 text-center text-ink-2">{tr('Type in the search bar above, then press Enter.')}</p>
      </>
    )

  // No page title (mockup): the text is in the search bar; chips pick where to look.
  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-4 pb-4.5">
        <div role="tablist" aria-label={tr('Search in')} className="flex flex-wrap items-center gap-2">
          <LedChip on={from === 'all'} label={tr('All')} onClick={() => pickFrom('all')} />
          <LedChip on={from === 'library'} label={tr('Your library')} count={formatCount(lib.songs.length)} onClick={() => pickFrom('library')} />
          {ytOn && chip('ytmusic', 'YouTube Music')}
          {chip('youtube', 'YouTube')}
          {chip('apple', 'Apple Music')}
        </div>
        {everywhere && (
          <label className="flex shrink-0 items-center gap-2 text-xs text-ink-2">
            {tr('Hide covers and karaoke')} <Toggle label={tr('Hide covers and karaoke')} checked={hideCovers} onChange={setHideCovers} />
          </label>
        )}
      </div>
      {/* Behind a section's Show all: its title, and the way back. */}
      {shown !== 'all' && (
        <div className="flex shrink-0 items-center gap-2 pb-3">
          <RoundButton label={tr('Search results')} kind="plain" size="sm" className="nudge-l" onClick={() => setKind('all')}>
            <ArrowLeft size={18} />
          </RoundButton>
          <h2 className="text-[1.375rem] leading-7 font-bold">{tr(KINDS[shown])}</h2>
        </div>
      )}

      {!everywhere && shown === 'songs' ? (
        <TrackTable tracks={lib.songs} empty={tr('No results.')} />
      ) : (
        <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-8">
          {shown === 'all' && all}
          {shown === 'songs' && (
            <div className="flex flex-col gap-6">
              {mine.songs.length > 0 && (
                <Section title={tr('In your library')} onAll={mine.songs.length > 10 ? () => pickFrom('library') : undefined}>
                  <ul>
                    {mine.songs.slice(0, 10).map((t, i) => (
                      <LibraryRow key={t.id} list={mine.songs} i={i} />
                    ))}
                  </ul>
                </Section>
              )}
              {songs.length > 0 && (
                <Section title={tr('Catalogs')}>
                  <ul>{hitRows(songs)}</ul>
                </Section>
              )}
            </div>
          )}
          {shown === 'videos' && (
            <>
              <ul>{hitRows(videos)}</ul>
              <HiddenFold key={round} count={others.length} className="mt-3">
                <ul>{hitRows(others)}</ul>
              </HiddenFold>
            </>
          )}
          {shown === 'artists' && (
            <>
              <ul className={grid}>{mine.artists.slice(0, MANY).map(artistCard)}</ul>
              {tooMany(mine.artists.length, 'artists')}
            </>
          )}
          {shown === 'albums' && (
            <>
              <ul className={grid}>{mine.albums.slice(0, MANY).map(albumCard)}</ul>
              {tooMany(mine.albums.length, 'albums')}
            </>
          )}
          {shown === 'playlists' && <ul className={grid}>{playlistCards}</ul>}
          {nothing && <p className="py-8 text-center text-ink-2">{tr('No results.')}</p>}
          {busy && !results && shown !== 'all' && <p className="py-8 text-center text-ink-2">{tr('Searching…')}</p>}
          {/* Who else was asked, quietly at the bottom. */}
          {everywhere && shown === 'all' && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-8 text-xs text-ink-3">
              {!ytOn && (
                <span className="flex items-center gap-1.5">
                  <SourceIcon source="youtube" size={12} /> YouTube Music ·
                  <button onClick={() => go({ name: 'settings', section: 'sources' })} className="font-medium text-ink-2 hover:text-ink hover:underline">
                    {tr('Sign in')}
                  </button>
                </span>
              )}
              <span>Spotify · {tr('Search closed without Premium')}</span>
            </p>
          )}
        </div>
      )}
    </>
  )
}

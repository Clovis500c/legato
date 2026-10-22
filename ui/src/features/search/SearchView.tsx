import { CaretRight, Check, Play, Plus, Shuffle, SpinnerGap } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type Origin, type SearchHit, type SearchResults, type Track } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatCount, formatDuration, region, spotifyList } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { LedChip, RoundButton, Segmented, Toggle } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { kindLabel, unofficial, videoKind } from '../add/kind'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { groupAlbums, groupArtists, type AlbumGroup, type ArtistGroup } from '../library/filter'
import { HiddenFold } from '../library/HiddenVideos'
import { PlaylistCover } from '../library/PlaylistCover'
import { TrackTable } from '../library/TrackTable'
import { hitMenu, trackMenu, tracksMenu } from '../menus'
import { remoteTrack, usePlayer } from '../player/store'
import { addRecent } from './recent'
import { countBy, errorOf, isSong, isVideo, libraryMatches, type Kind, type Scope } from './results'

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

function HitRow({ hit, onAdded, onPlay, extra }: { hit: SearchHit; onAdded: (id: number) => void; onPlay: () => void; extra?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const kind = hit.ids.youtube && !hit.ids.apple ? videoKind(hit.title) : null
  const add = async () => {
    setBusy(true)
    try {
      onAdded(await api.addTrack(trackOf(hit)))
      await useStore.getState().refresh()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    // Double-click plays it, in the library or not.
    <li onContextMenu={onMenu(() => hitMenu(hit, add, busy, onPlay))} onDoubleClick={onPlay} className="group flex items-center gap-3.5 border-b border-line-soft px-2 py-2.5">
      <RoundButton label={tr('Play {title}', { title: hit.title })} kind="plain" size="sm" onClick={onPlay}>
        <Play size={14} weight="fill" />
      </RoundButton>
      <Cover title={hit.album ?? hit.title} art={trackArt({ ...hit, id: hit.libraryId ?? undefined })} size={42} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[0.8125rem] font-semibold">
          {hit.title} {kind && <Badge>{tr(kindLabel[kind])}</Badge>}
          {hit.musicness === 'notMusic' && <Badge>{tr('NOT MUSIC?')}</Badge>}
        </p>
        <p className="truncate text-xs text-ink-2">{[hit.artist, hit.album].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="flex items-center gap-2 text-ink-3">
        {order.filter((s) => hit.ids[s]).map((s) => (
          <SourceIcon key={s} source={s} size={13} />
        ))}
      </span>
      <span className="w-11 text-right font-mono text-[0.6875rem] text-ink-3">{formatDuration(hit.durationMs)}</span>
      {extra}
      {hit.libraryId ? (
        <RoundButton label={tr('Already in your library')} kind="ink" size="sm" disabled>
          <Check size={14} />
        </RoundButton>
      ) : (
        <RoundButton label={tr('Add {title}', { title: hit.title })} kind="soft" size="sm" disabled={busy} onClick={add}>
          <Plus size={14} />
        </RoundButton>
      )}
    </li>
  )
}

/** A library song among the results: plays the matching songs from there. */
function LibraryRow({ list, i }: { list: LibraryTrack[]; i: number }) {
  const t = list[i]
  const play = () => usePlayer.getState().playTracks(list, i)
  return (
    <li onContextMenu={onMenu(() => trackMenu(t, { list, index: i }))} onDoubleClick={play} className="group flex items-center gap-3.5 border-b border-line-soft px-2 py-2.5">
      <RoundButton label={tr('Play {title}', { title: t.title })} kind="plain" size="sm" onClick={play}>
        <Play size={14} weight="fill" />
      </RoundButton>
      <Cover title={t.album ?? t.title} art={trackArt(t)} size={42} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] font-semibold">{t.title}</p>
        <p className="truncate text-xs text-ink-2">{[t.artist, t.album].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="rounded-full bg-raised px-2 py-0.5 text-[0.6875rem] text-ink-2">{tr('In your library')}</span>
      <span className="w-11 text-right font-mono text-[0.6875rem] text-ink-3">{formatDuration(t.durationMs)}</span>
    </li>
  )
}

/** Square (or round) card: cover, name, line under. */
function Tile({ title, sub, art, round, onOpen, menu }: { title: string; sub: string; art: ReactNode; round?: boolean; onOpen: () => void; menu?: () => ReturnType<typeof tracksMenu> }) {
  return (
    <li onContextMenu={menu && onMenu(menu)} className="w-36 shrink-0">
      <button onClick={onOpen} className="group flex w-full flex-col gap-2 text-left">
        <span className={`block size-36 overflow-hidden ${round ? 'rounded-full' : 'rounded-cover'}`}>{art}</span>
        <span className="block truncate text-[0.8125rem] font-semibold group-hover:underline">{title}</span>
        <span className="-mt-1.5 block truncate text-xs text-ink-2">{sub}</span>
      </button>
    </li>
  )
}

/** YouTube result as a 16:9 card (thumbnails are 4:3 with bars: the crop drops them). */
function VideoCard({ hit, onPlay, onAdded }: { hit: SearchHit; onPlay: () => void; onAdded: (id: number) => void }) {
  const src = trackArt({ ...hit, id: hit.libraryId ?? undefined })[0]
  const add = () => void api.addTrack(trackOf(hit)).then(async (id) => (onAdded(id), await useStore.getState().refresh()), (e) => useStore.setState({ error: String(e) }))
  return (
    <li onContextMenu={onMenu(() => hitMenu(hit, add, false, onPlay))} className="min-w-0">
      <button onClick={onPlay} className="group flex w-full flex-col gap-2 text-left">
        <span className="relative block aspect-video overflow-hidden rounded-cover border border-line-soft bg-recess">
          {src && <img src={src} alt="" loading="lazy" crossOrigin="anonymous" className="size-full object-cover" />}
          {hit.durationMs && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1.5 font-mono text-[0.6875rem] text-white">{formatDuration(hit.durationMs)}</span>}
        </span>
        <span className="line-clamp-2 text-[0.8125rem] font-semibold group-hover:underline">{hit.title}</span>
        <span className="-mt-1.5 truncate text-xs text-ink-2">{hit.artist}</span>
      </button>
    </li>
  )
}

function Section({ title, onAll, children }: { title: string; onAll?: () => void; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-bold tracking-[-0.02em]">{title}</h2>
        {onAll && (
          <button onClick={onAll} className="flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
            {tr('See all')} <CaretRight size={11} weight="bold" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * Results of the top bar's search (the only search field): your library and the catalogs (YouTube, YouTube Music,
 * Apple Music), by type. Your library alone = no network. The line under the tabs says which services answered.
 */
export function SearchView() {
  const request = useStore((s) => s.search)
  const { tracks, playlists, status, go } = useStore()
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
    await useStore.getState().refresh()
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

  const artistTile = (a: ArtistGroup) => <Tile key={a.artist} round title={a.artist} sub={trn(a.count, '{n} song', '{n} songs')} art={<Cover title={a.artist} art={trackArt(a.cover)} size={144} className="size-full! rounded-full!" />} onOpen={() => go({ name: 'artist', artist: a.artist })} menu={() => tracksMenu(a.tracks)} />
  const albumTile = (a: AlbumGroup) => <Tile key={`${a.album}\u0000${a.artist}`} title={a.album} sub={a.artist} art={<Cover title={a.album} art={trackArt(a.tracks[0])} size={144} className="size-full!" />} onOpen={() => go({ name: 'album', album: a.album, artist: a.artist })} menu={() => tracksMenu(a.tracks)} />
  const playlistTiles = lib.playlists.map((p) => <Tile key={p.id} title={p.name} sub={trn(p.trackCount, '{n} song', '{n} songs')} art={<PlaylistCover p={p} size={144} big />} onOpen={() => go({ name: 'playlist', id: p.id })} />)
  // Library page filtered by the same text (its own token on).
  const openPage = (name: 'songs' | 'albums' | 'artists') => {
    go({ name })
    useStore.getState().setQuery(q)
  }
  const tooMany = (n: number, name: 'albums' | 'artists') =>
    n > MANY && (
      <button onClick={() => openPage(name)} className="mt-4 text-xs font-semibold text-ink-2 hover:text-ink">
        {tr('See all {n} in {page}', { n: formatCount(n), page: tr(name === 'albums' ? 'Albums' : 'Artists') })}
      </button>
    )

  // Top result: an artist of yours, else the first song.
  const topArtist = lib.artists[0]
  const topSong = !topArtist ? (lib.songs[0] ?? null) : null
  const topHit = !topArtist && !topSong ? (songs[0] ?? videos[0] ?? null) : null
  const top = (topArtist || topSong || topHit) && (
    <div className="flex w-80 shrink-0 flex-col gap-4 rounded-xl border border-line bg-panel p-5">
      <p className="kicker">{tr('Top result')}</p>
      {topArtist ? (
        <>
          <Cover title={topArtist.artist} art={trackArt(topArtist.cover)} size={104} className="rounded-full!" />
          <div className="flex min-w-0 flex-col gap-1">
            <button onClick={() => go({ name: 'artist', artist: topArtist.artist })} className="truncate text-left text-[1.75rem] leading-tight font-bold tracking-[-0.02em] hover:underline">
              {topArtist.artist}
            </button>
            <p className="text-xs text-ink-2">
              {tr('Artist')} · {trn(topArtist.count, '{n} song', '{n} songs')}
            </p>
          </div>
          <div className="flex gap-2">
            <RoundButton label={tr('Play {title}', { title: topArtist.artist })} kind="primary" onClick={() => play(topArtist.tracks, 0)}>
              <Play size={16} weight="fill" />
            </RoundButton>
            <RoundButton label={tr('Shuffle play')} onClick={() => (usePlayer.setState({ shuffle: true }), play(topArtist.tracks, Math.floor(Math.random() * topArtist.tracks.length)))}>
              <Shuffle size={16} />
            </RoundButton>
          </div>
        </>
      ) : (
        (() => {
          const t = (topSong ?? topHit)!
          return (
            <>
              <Cover title={t.album ?? t.title} art={trackArt(topSong ?? { ...topHit!, id: topHit!.libraryId ?? undefined })} size={104} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="truncate text-[1.75rem] leading-tight font-bold tracking-[-0.02em]">{t.title}</p>
                <p className="truncate text-xs text-ink-2">
                  {tr('Song')} · {t.artist}
                </p>
              </div>
              <RoundButton label={tr('Play {title}', { title: t.title })} kind="primary" onClick={() => (topSong ? play(lib.songs, 0) : void playHit(topHit!, songs.length ? songs : videos))}>
                <Play size={16} weight="fill" />
              </RoundButton>
            </>
          )
        })()
      )}
    </div>
  )

  const libSongs = lib.songs.slice(0, everywhere ? 2 : FEW)
  const songsList = (
    <ul className="min-w-0 flex-1">
      {libSongs.map((t, i) => (
        <LibraryRow key={t.id} list={lib.songs} i={i} />
      ))}
      {everywhere && hitRows(songs.slice(0, FEW - libSongs.length))}
    </ul>
  )
  const anySongs = lib.songs.length > 0 || (everywhere && songs.length > 0)
  const nothing = !busy && !anySongs && !videos.length && !others.length && !lib.artists.length && !lib.albums.length && !lib.playlists.length && !identified

  const all = (
    <div className="flex flex-col gap-9">
      {identified && (
        <section>
          <h2 className="kicker pb-1.5">{tr('Identified by AudD')}</h2>
          <ul>
            <HitRow hit={identified} onAdded={(id) => setFound((f) => f && { ...f, libraryId: id })} onPlay={() => void playOne(identified)} extra={<AddToPlaylist trackIds={identifiedIds} label={tr('Add {title} to a playlist', { title: identified.title })} />} />
          </ul>
        </section>
      )}
      {(top || anySongs) && (
        <div className="flex items-start gap-7">
          {top}
          {anySongs && (
            <Section title={tr('Songs')} onAll={() => setKind('songs')}>
              {songsList}
            </Section>
          )}
        </div>
      )}
      {everywhere && videos.length > 0 && (
        <Section title={tr('Videos')} onAll={() => setKind('videos')}>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
            {videos.slice(0, 4).map((h) => (
              <VideoCard key={Object.values(h.ids).join('|')} hit={h} onPlay={() => void playHit(h, videos)} onAdded={(id) => markAdded(h, id)} />
            ))}
          </ul>
        </Section>
      )}
      {lib.artists.length > 0 && (
        <Section title={tr('Artists')} onAll={() => setKind('artists')}>
          <ul className="flex gap-5 overflow-x-auto pb-2">{lib.artists.slice(0, ROW).map(artistTile)}</ul>
        </Section>
      )}
      {lib.albums.length > 0 && (
        <Section title={tr('Albums')} onAll={() => setKind('albums')}>
          <ul className="flex gap-5 overflow-x-auto pb-2">{lib.albums.slice(0, ROW).map(albumTile)}</ul>
        </Section>
      )}
      {lib.playlists.length > 0 && (
        <Section title={tr('Playlists')} onAll={() => setKind('playlists')}>
          <ul className="flex gap-5 overflow-x-auto pb-2">{playlistTiles.slice(0, ROW)}</ul>
        </Section>
      )}
      {everywhere && (
        <HiddenFold key={round} count={others.length}>
          <ul>{hitRows(others)}</ul>
        </HiddenFold>
      )}
    </div>
  )

  const grid = 'flex flex-wrap gap-5'
  const tabs: { id: Kind; label: string; n: number }[] = [
    { id: 'all', label: tr('All'), n: lib.songs.length + (everywhere ? music.length : 0) },
    { id: 'songs', label: tr('Songs'), n: lib.songs.length + (everywhere ? songs.length : 0) },
    ...(everywhere ? [{ id: 'videos' as const, label: tr('Videos'), n: videos.length }] : []),
    { id: 'albums', label: tr('Albums'), n: lib.albums.length },
    { id: 'artists', label: tr('Artists'), n: lib.artists.length },
    { id: 'playlists', label: tr('Playlists'), n: lib.playlists.length },
  ]
  const shown = kind === 'videos' && !everywhere ? 'all' : kind

  // One button per catalog: count (or why it's missing); a click shows its results only.
  const source = (o: Origin, name: string) => {
    const error = results && errorOf(results.errors, o)
    return (
      <button key={o} aria-pressed={only === o} title={error} onClick={() => setOnly(only === o ? null : o)} className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 transition ${only === o ? 'bg-ink text-bg' : 'hover:bg-raised'} ${error ? 'text-danger' : ''}`}>
        <SourceIcon source={o === 'apple' ? 'apple' : 'youtube'} size={12} />
        {name} · {error ? tr('Failed') : busy && !results ? '…' : formatCount(counts[o])}
      </button>
    )
  }

  if (!request)
    return (
      <>
        <PageHeader kicker={tr('Search results')} title={tr('Search')} />
        <p className="py-10 text-center text-ink-2">{tr('Type in the search bar above, then press Enter.')}</p>
      </>
    )

  return (
    <>
      <PageHeader kicker={tr('Search results')} title={`“${q}”`} actions={<Segmented label={tr('Search in')} value={scope} onChange={setScope} options={[{ value: 'everywhere', label: tr('Everywhere') }, { value: 'library', label: tr('Your library') }]} />} />
      <div className="flex shrink-0 items-center justify-between gap-4 pb-2.5">
        <div role="tablist" aria-label={tr('Search results')} className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <LedChip key={t.id} on={shown === t.id} label={t.label} count={formatCount(t.n)} onClick={() => setKind(t.id)} />
          ))}
        </div>
        {everywhere && (
          <label className="flex shrink-0 items-center gap-2 text-xs text-ink-2">
            {tr('Hide covers and karaoke')} <Toggle label={tr('Hide covers and karaoke')} checked={hideCovers} onChange={setHideCovers} />
          </label>
        )}
      </div>
      {everywhere && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 pb-4 text-xs text-ink-2">
          <span className="text-ink-3">{tr('Searched')}</span>
          <span className="px-2 py-0.5">
            {tr('Your library')} · {formatCount(lib.songs.length)}
          </span>
          {ytOn ? (
            source('ytmusic', 'YouTube Music')
          ) : (
            <button onClick={() => go({ name: 'settings', section: 'sources' })} className="rounded-full px-2 py-0.5 text-ink-3 hover:bg-raised hover:text-ink">
              YouTube Music · {tr('Sign in')}
            </button>
          )}
          {source('youtube', 'YouTube')}
          {source('apple', 'Apple Music')}
          <span className="px-2 py-0.5 text-ink-3">Spotify · {tr('Search closed without Premium')}</span>
          {busy && <SpinnerGap size={13} className="animate-spin text-ink-3" aria-label={tr('Searching…')} />}
        </div>
      )}

      {!everywhere && shown === 'songs' ? (
        <TrackTable tracks={lib.songs} empty={tr('No results.')} />
      ) : (
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {shown === 'all' && all}
          {shown === 'songs' && (
            <div className="flex flex-col gap-6">
              {lib.songs.length > 0 && (
                <Section title={tr('In your library')} onAll={lib.songs.length > 10 ? () => setScope('library') : undefined}>
                  <ul>
                    {lib.songs.slice(0, 10).map((t, i) => (
                      <LibraryRow key={t.id} list={lib.songs} i={i} />
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
              <ul className={grid}>{lib.artists.slice(0, MANY).map(artistTile)}</ul>
              {tooMany(lib.artists.length, 'artists')}
            </>
          )}
          {shown === 'albums' && (
            <>
              <ul className={grid}>{lib.albums.slice(0, MANY).map(albumTile)}</ul>
              {tooMany(lib.albums.length, 'albums')}
            </>
          )}
          {shown === 'playlists' && <ul className={grid}>{playlistTiles}</ul>}
          {nothing && <p className="py-8 text-center text-ink-2">{tr('No results.')}</p>}
          {busy && !results && shown !== 'all' && <p className="py-8 text-center text-ink-2">{tr('Searching…')}</p>}
        </div>
      )}
    </>
  )
}

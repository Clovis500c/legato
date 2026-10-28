import { CaretLeft, CaretRight, DotsThree, Play, Plus, Radio, SpinnerGap, Waveform } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../app/store'
import { api, type AlbumInfo, type LibraryTrack, type ListRef, type Track, type YtmArtist } from '../../shared/api'
import { firstArt, remoteArt, trackArt } from '../../shared/art'
import { fold, formatCount, formatDuration, region } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { onMenu, openMenu } from '../../shared/ui/ContextMenu'
import { LedChip, RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { YouTubeShelf } from '../home/HomeView'
import { trackMenu, tracksMenu } from '../menus'
import { useMixes } from '../mixes/MixesView'
import { remoteTrack, usePlayer } from '../player/store'
import { vias } from '../player/sources'
import { AddToPlaylist } from './AddToPlaylist'
import { albumRows } from './albumPage'
import { discography } from './discography'
import { groupAlbums, primaryArtist, type AlbumGroup } from './filter'
import { PlayAll, ShuffleRound, totalTime } from './LibraryView'
import { TrackTable } from './TrackTable'

/** Titled block with an optional link on the right. */
function Section({ title, side, children }: { title: ReactNode; side?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-4 text-xl font-bold tracking-[-0.02em]">{title}</h2>
        {side}
      </div>
      {children}
    </section>
  )
}

function SideLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
      {label} <CaretRight size={11} weight="bold" />
    </button>
  )
}

/** Album cover card; a click opens the album. */
function AlbumCard({ a, sub }: { a: AlbumGroup; sub: string }) {
  const go = useStore((s) => s.go)
  return (
    <li onContextMenu={onMenu(() => tracksMenu(a.tracks))} className="w-37.5 shrink-0">
      <button onClick={() => go({ name: 'album', album: a.album, artist: a.artist })} className="group flex w-full flex-col gap-2 text-left">
        <Cover title={a.album} art={firstArt(a.tracks)} size={150} className="lift" />
        <span className="truncate text-[0.8125rem] font-semibold group-hover:underline">{a.album}</span>
        <span className="-mt-1.5 truncate text-xs text-ink-2">{sub}</span>
      </button>
    </li>
  )
}

/** One song row: number (or the song playing; hovered: play), title, what else, duration. */
function SongRow({ list, i, cover, extra, sub, number }: { list: LibraryTrack[]; i: number; cover?: boolean; extra?: ReactNode; sub?: string; number?: number }) {
  const t = list[i]
  const play = usePlayer((s) => s.playTracks)
  const on = usePlayer((s) => s.now?.trackId === t.id)
  const sp = useStore((s) => s.status.spotify.connected)
  const playable = vias(t, sp).length > 0
  return (
    <li onContextMenu={onMenu(() => trackMenu(t, { list, index: i }))} onDoubleClick={() => playable && play(list, i)} className="group flex h-13 items-center gap-4 rounded-md px-3 hover:bg-raised">
      <span className="flex w-6 shrink-0 justify-end text-xs text-ink-3 tabular-nums">
        <span className={playable ? 'group-hover:hidden' : ''}>{on ? <Waveform size={14} className="text-accent" /> : (number ?? i + 1)}</span>
        {playable && (
          <button aria-label={tr('Play {title}', { title: t.title })} onClick={() => play(list, i)} className="hidden text-ink group-hover:block">
            <Play size={13} weight="fill" />
          </button>
        )}
      </span>
      {cover && <Cover title={t.album ?? t.title} art={trackArt(t)} size={40} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-[0.8125rem] font-semibold ${on ? 'text-accent' : ''}`}>{t.title}</span>
        {sub && <span className="truncate text-xs text-ink-2">{sub}</span>}
      </span>
      {extra}
      <span className="w-12 shrink-0 text-right text-xs text-ink-3 tabular-nums">{formatDuration(t.durationMs)}</span>
    </li>
  )
}

/** A song of the album you don't have: dimmed, plays its full version (found on YouTube), one click adds it. */
function MissingRow({ track, number, sub }: { track: Track; number: number; sub?: string }) {
  const [busy, setBusy] = useState(false)
  const play = async () => usePlayer.getState().playTracks([remoteTrack(await api.resolveTrack(track).catch(() => track))], 0)
  const add = async () => {
    setBusy(true)
    try {
      await api.addTrack(await api.resolveTrack(track).catch(() => track))
      await useStore.getState().refreshChanged()
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <li onDoubleClick={() => void play()} className="group flex h-13 items-center gap-4 rounded-md px-3 text-ink-3 hover:bg-raised">
      <span className="flex w-6 shrink-0 justify-end text-xs tabular-nums">
        <span className="group-hover:hidden">{number}</span>
        <button aria-label={tr('Play {title}', { title: track.title })} onClick={() => void play()} className="hidden text-ink group-hover:block">
          <Play size={13} weight="fill" />
        </button>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.8125rem] font-semibold">{track.title}</span>
        <span className="truncate text-xs">{sub ? `${sub} · ` : ''}{tr('Not in your library')}</span>
      </span>
      <RoundButton label={tr('Add {title}', { title: track.title })} kind="soft" size="sm" disabled={busy} onClick={() => void add()}>
        <Plus size={14} />
      </RoundButton>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums">{formatDuration(track.durationMs)}</span>
    </li>
  )
}

/** Catalog details of an album (year, every song): asked again when your songs of it change. */
function useAlbumInfo(album: string, artist: string, ids: number[]) {
  const [info, setInfo] = useState<AlbumInfo | null>(null)
  const key = ids.join(',')
  useEffect(() => {
    let live = true
    api.albumInfo(artist, album, ids, region()).then((i) => live && setInfo(i), () => live && setInfo(null))
    return () => void (live = false)
  }, [album, artist, key]) // key = ids
  return info
}

/** An album read as an album: its songs numbered without covers, the artist only when someone else sings, then more by the artist. */
export function AlbumView({ album, artist }: { album: string; artist: string }) {
  const { tracks, stats, go } = useStore(useShallow(({ tracks, stats, go }) => ({ tracks, stats, go })))
  const shown = useMemo(() => tracks.filter((t) => t.album && fold(t.album) === fold(album) && fold(primaryArtist(t.artist)) === fold(artist)), [tracks, album, artist])
  const more = useMemo(() => groupAlbums(tracks.filter((t) => fold(primaryArtist(t.artist)) === fold(artist) && !(t.album && fold(t.album) === fold(album)))).slice(0, 6), [tracks, album, artist])
  const toArtist = () => go({ name: 'artist', artist })
  const info = useAlbumInfo(album, artist, shown.map((t) => t.id))
  const page = useMemo(() => (info && info.slots.length ? albumRows(info, shown) : null), [info, shown])
  const missing = page ? page.rows.filter((r) => 'missing' in r).length : 0
  const ordered = page?.ordered ?? shown
  const plays = (t: LibraryTrack) => <span className="w-14 shrink-0 text-right text-xs text-ink-3 tabular-nums">{stats[t.id]?.[0] ? formatCount(stats[t.id][0]) : ''}</span>
  const featured = (t: Track) => (primaryArtist(t.artist) !== t.artist ? t.artist : undefined)
  return (
    <div className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-8">
      <PageHeader
        onContextMenu={onMenu(() => tracksMenu(shown, ['-', { label: tr('Go to artist'), onSelect: toArtist }]))}
        art={<Cover title={album} art={firstArt(shown)} size={200} eager className="shadow-[0_12px_32px_var(--shadow)]" />}
        kicker={tr('Album')}
        title={album}
        sub={
          <span className="flex items-center gap-2">
            <button onClick={toArtist} className="font-semibold text-ink hover:underline">
              {artist}
            </button>
            {info?.year && <>· {info.year}</>} · {missing ? tr('{n} of {total} songs', { n: shown.length, total: shown.length + missing }) : trn(shown.length, '{n} song', '{n} songs')} · {totalTime(shown)}
          </span>
        }
        actions={
          <>
            <PlayAll tracks={ordered} />
            <ShuffleRound tracks={ordered} />
            <AddToPlaylist trackIds={ordered.map((t) => t.id)} label={tr('Add {n} songs to a playlist', { n: shown.length })} />
            <RoundButton label={tr('More')} kind="plain" onClick={(e) => openMenu(e, tracksMenu(shown, ['-', { label: tr('Go to artist'), onSelect: toArtist }]))}>
              <DotsThree size={20} weight="bold" />
            </RoundButton>
          </>
        }
      />
      {page ? (
        <>
          <ul className="flex flex-col border-t border-line pt-1">
            {page.rows.map((r, k) => (
              <Fragment key={k}>
                {page.discs > 1 && (k === 0 || page.rows[k - 1].disc !== r.disc) && <li className="kicker px-3 pt-4 pb-1">{tr('Disc {n}', { n: r.disc })}</li>}
                {'mine' in r ? <SongRow list={ordered} i={ordered.indexOf(r.mine)} number={r.number} sub={featured(r.mine)} extra={plays(r.mine)} /> : <MissingRow track={r.missing} number={r.number} sub={featured(r.missing)} />}
              </Fragment>
            ))}
          </ul>
          {page.extras.length > 0 && (
            <div className="pt-6">
              <h2 className="kicker px-3 pb-1">{tr('Also in your library')}</h2>
              <ul className="flex flex-col">
                {page.extras.map((t) => (
                  <SongRow key={t.id} list={ordered} i={ordered.indexOf(t)} sub={featured(t)} extra={plays(t)} />
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <ul className="flex flex-col border-t border-line pt-1">
          {shown.map((t, i) => (
            <SongRow key={t.id} list={shown} i={i} sub={featured(t)} extra={plays(t)} />
          ))}
        </ul>
      )}
      {more.length > 0 && (
        <div className="pt-9">
          <Section title={tr('More by {artist}', { artist })} side={<SideLink label={tr('Go to artist')} onClick={toArtist} />}>
            <ul className="flex gap-5 overflow-x-auto pb-2">
              {more.map((a) => (
                <AlbumCard key={a.album} a={a} sub={trn(a.tracks.length, '{n} song', '{n} songs')} />
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  )
}

/** YouTube Music's radio from the artist's most played song (signed in), else the artist mixed with your mixes. */
async function startRadio(songs: LibraryTrack[], mixes: { trackIds: number[] }[] | undefined, all: LibraryTrack[]) {
  const { status, notify } = useStore.getState()
  const play = usePlayer.getState().playTracks
  const seed = songs.find((t) => t.ids.youtube)
  if (status.youtube.connected && seed) {
    const video = seed.ids.youtube!
    try {
      const radio = (await api.ytmList({ type: 'radio', videoId: video, playlistId: `RDAMVM${video}` })).map(remoteTrack)
      if (radio.length) return play(radio, 0)
    } catch (e) {
      notify(String(e), { kind: 'error' })
    }
  }
  const mine = new Set(songs.map((t) => t.id))
  const byId = new Map(all.map((t) => [t.id, t]))
  const near = (mixes ?? []).filter((m) => m.trackIds.some((id) => mine.has(id))).flatMap((m) => m.trackIds.flatMap((id) => (mine.has(id) ? [] : (byId.get(id) ?? []))))
  const mixed = [...songs, ...new Map(near.map((t) => [t.id, t])).values()].sort(() => Math.random() - 0.5)
  if (mixed.length) play(mixed, 0)
}

/** The artist's YouTube Music page (public, signed in or not). undefined = loading, null = none there. */
function useYtmArtist(artist: string) {
  const [page, setPage] = useState<YtmArtist | null>()
  useEffect(() => {
    let live = true
    setPage(undefined)
    api.ytmArtist(artist).then(
      (p) => live && setPage(p),
      () => live && setPage(null),
    )
    return () => void (live = false)
  }, [artist])
  return page
}

/**
 * An artist in sections: your most played, YouTube Music's top songs (every song on demand), the discography (albums,
 * singles and EPs), then the artist's YouTube Music shelves: albums, videos, playlists they're on, their own playlists.
 */
export function ArtistView({ artist }: { artist: string }) {
  const { tracks, stats } = useStore(useShallow(({ tracks, stats }) => ({ tracks, stats })))
  const { mixes } = useMixes()
  // Every song: yours, or YouTube Music's (its list, loaded on demand).
  const [all, setAll] = useState<'mine' | 'youtube' | null>(null)
  const [everySong, setEverySong] = useState<LibraryTrack[] | null>(null)
  const [kind, setKind] = useState<'albums' | 'singles'>('albums')
  const yt = useYtmArtist(artist)
  const ytSongs = useMemo(() => (yt?.songs ?? []).map(remoteTrack), [yt])
  const shown = useMemo(() => tracks.filter((t) => fold(primaryArtist(t.artist)) === fold(artist)), [tracks, artist])
  const top = useMemo(() => [...shown].sort((a, b) => (stats[b.id]?.[0] ?? 0) - (stats[a.id]?.[0] ?? 0)).slice(0, 5), [shown, stats])
  const disco = useMemo(() => discography(tracks, artist), [tracks, artist])
  const releases = kind === 'singles' && disco.singles.length ? disco.singles : disco.albums.length ? disco.albums : disco.singles
  // Not in your library: YouTube Music's songs play.
  const playable = shown.length ? shown : ytSongs
  const openEvery = (list: ListRef) => {
    setAll('youtube')
    setEverySong(null)
    api.ytmList(list).then(
      (t) => setEverySong(t.map(remoteTrack)),
      (e) => (useStore.getState().notify(String(e), { kind: 'error' }), setAll(null)),
    )
  }
  const header = (
    <PageHeader
      onContextMenu={onMenu(() => tracksMenu(playable))}
      art={<Cover title={artist} art={shown.length || !yt?.art ? firstArt(shown) : [remoteArt(yt.art)]} size={168} eager className="rounded-full!" />}
      kicker={tr('Artist')}
      title={artist}
      sub={shown.length ? `${trn(shown.length, '{n} song', '{n} songs')} · ${trn(disco.albums.length + disco.singles.length, '{n} album', '{n} albums')} · ${totalTime(shown)}` : undefined}
      actions={
        <>
          <PlayAll tracks={playable} />
          <ShuffleRound tracks={playable} />
          <Button variant="ghost" onClick={() => void startRadio(top.length ? top : playable, mixes, tracks)}>
            <Radio size={16} /> {tr('Radio')}
          </Button>
          <RoundButton label={tr('More')} kind="plain" onClick={(e) => openMenu(e, tracksMenu(playable))}>
            <DotsThree size={20} weight="bold" />
          </RoundButton>
        </>
      }
    />
  )
  if (all)
    return (
      <>
        {header}
        <button onClick={() => setAll(null)} className="mb-2 flex w-fit items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
          <CaretLeft size={11} weight="bold" /> {tr('Back to {artist}', { artist })}
        </button>
        {all === 'mine' ? <TrackTable tracks={shown} empty={tr('No songs.')} /> : <TrackTable tracks={everySong ?? []} empty={everySong ? tr('No songs.') : <SpinnerGap size={20} className="animate-spin" />} />}
      </>
    )
  return (
    <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-9 overflow-y-auto px-2 pb-8">
      {header}
      {top.length > 0 && (
        <Section title={tr('Your most played')} side={shown.length > top.length && <SideLink label={tr('All {n} songs', { n: formatCount(shown.length) })} onClick={() => setAll('mine')} />}>
          <ul className="-mt-1 flex flex-col">
            {top.map((t, i) => (
              <SongRow key={t.id} list={top} i={i} cover extra={<span className="hidden w-56 truncate text-xs text-ink-2 md:block">{t.album}</span>} sub={stats[t.id]?.[0] ? trn(stats[t.id][0], '{n} play', '{n} plays') : undefined} />
            ))}
          </ul>
        </Section>
      )}
      {ytSongs.length > 0 && (
        <Section
          title={
            <>
              <SourceIcon source="youtube" size={18} /> {tr('Top songs')}
            </>
          }
          side={yt?.allSongs && <SideLink label={tr('See all')} onClick={() => openEvery(yt.allSongs!)} />}
        >
          <ul className="-mt-1 flex flex-col">
            {ytSongs.map((t, i) => (
              <SongRow key={t.id} list={ytSongs} i={i} cover extra={<span className="hidden w-56 truncate text-xs text-ink-2 md:block">{t.album}</span>} sub={t.artist} />
            ))}
          </ul>
        </Section>
      )}
      {releases.length > 0 && (
        <Section
          title={
            <>
              {tr('Discography')}
              {disco.albums.length > 0 && disco.singles.length > 0 && (
                <span role="tablist" className="flex gap-2 text-xs font-normal tracking-normal">
                  <LedChip on={releases === disco.albums} label={tr('Albums')} onClick={() => setKind('albums')} />
                  <LedChip on={releases === disco.singles} label={tr('Singles and EPs')} onClick={() => setKind('singles')} />
                </span>
              )}
            </>
          }
        >
          <ul className="flex gap-5 overflow-x-auto pb-2">
            {releases.map((a) => (
              <AlbumCard key={a.album} a={a} sub={trn(a.tracks.length, '{n} song', '{n} songs')} />
            ))}
          </ul>
        </Section>
      )}
      {yt?.shelves.map((s) => <YouTubeShelf key={s.title} shelf={s} />)}
    </div>
  )
}

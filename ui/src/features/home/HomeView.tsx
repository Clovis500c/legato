import { CaretRight, Disc, MicrophoneStage, MusicNotes, Pause, Play, Playlist, PlusCircle, SpinnerGap, VinylRecord } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { api, playlistKey, type HomeItem, type LibraryTrack, type ListRef, type Shelf } from '../../shared/api'
import { remoteArt, trackArt } from '../../shared/art'
import { formatCount } from '../../shared/format'
import { onMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { groupAlbums, groupArtists, type Sort } from '../library/filter'
import { PlaylistCover } from '../library/PlaylistCover'
import { playerMenu, trackMenu } from '../menus'
import { MixCard, useMixes } from '../mixes/MixesView'
import { remoteTrack, useNowTrack, usePlayer } from '../player/store'
import { tr, trn } from '../../shared/i18n/i18n'

const CARD = 156
const ROW = 12

const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? tr('Good night') : h < 12 ? tr('Good morning') : h < 18 ? tr('Good afternoon') : tr('Good evening')
}

/** Titled row of cards, scrolled sideways. */
function Row({ kicker, title, action, children }: { kicker?: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {kicker && <p className="kicker flex items-center gap-1.5">{kicker}</p>}
          <h2 className="text-xl font-bold tracking-[-0.02em]">{title}</h2>
        </div>
        {action}
      </div>
      <ul className="-mx-2 flex snap-x gap-5 overflow-x-auto px-2 pb-2">{children}</ul>
    </section>
  )
}

/** sort = Songs page opens sorted that way. */
function SeeAll({ to, sort }: { to: View; sort?: Sort }) {
  const go = useStore((s) => s.go)
  return (
    <button onClick={() => (sort && useStore.getState().setSort(sort), go(to))} className="flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
      {tr('See all')} <CaretRight size={11} weight="bold" />
    </button>
  )
}

/** Cover, title, subtitle; round play button on hover. busy = list loading. */
function Card({ title, sub, art, round, onOpen, onPlay, menu, busy }: { title: string; sub: string; art: ReactNode; round?: boolean; onOpen: () => void; onPlay?: () => void; menu?: () => MenuEntry[]; busy?: boolean }) {
  return (
    <li onContextMenu={menu && onMenu(menu)} className="group relative flex shrink-0 snap-start flex-col gap-2" style={{ width: CARD }}>
      <button onClick={onOpen} className="flex flex-col gap-2 text-left">
        <span className={`relative block overflow-hidden ${round ? 'rounded-full' : 'rounded-cover'}`} style={{ width: CARD, height: CARD }}>
          {art}
        </span>
        <span className="block truncate text-[0.8125rem] font-semibold group-hover:underline">{title}</span>
        <span className="-mt-1.5 line-clamp-2 text-xs text-ink-2">{sub}</span>
      </button>
      {onPlay && (
        <RoundButton label={tr('Play {title}', { title })} kind="primary" size="md" className={`absolute right-2 ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`} style={{ top: CARD - 48 }} onClick={onPlay}>
          {busy ? <SpinnerGap size={16} className="animate-spin" /> : <Play weight="fill" size={16} />}
        </RoundButton>
      )}
    </li>
  )
}

/** Songs as cards; a click plays the row from there. */
function TrackCards({ tracks }: { tracks: LibraryTrack[] }) {
  const play = usePlayer((s) => s.playTracks)
  return tracks.map((t, i) => <Card key={t.id} title={t.title} sub={t.artist} art={<Cover title={t.album ?? t.title} art={trackArt(t)} size={CARD} className="size-full!" />} onOpen={() => play(tracks, i)} onPlay={() => play(tracks, i)} menu={() => trackMenu(t, { list: tracks, index: i })} />)
}

/** Big shortcuts to every part of the library; first one resumes what was playing. */
function QuickAccess() {
  const { tracks, playlists, go } = useStore()
  const counts = useMemo(() => ({ albums: groupAlbums(tracks).length, artists: groupArtists(tracks).length }), [tracks])
  const now = usePlayer((s) => s.now)
  const playing = usePlayer((s) => s.playing)
  const track = useNowTrack()
  const tiles: { icon: ReactNode; label: string; sub: string; onClick: () => void }[] = [
    { icon: <MusicNotes size={20} />, label: tr('Songs'), sub: formatCount(tracks.length), onClick: () => go({ name: 'songs' }) },
    { icon: <VinylRecord size={20} />, label: tr('Albums'), sub: formatCount(counts.albums), onClick: () => go({ name: 'albums' }) },
    { icon: <MicrophoneStage size={20} />, label: tr('Artists'), sub: formatCount(counts.artists), onClick: () => go({ name: 'artists' }) },
    { icon: <Disc size={20} />, label: tr('Mixes'), sub: tr('Made for you'), onClick: () => go({ name: 'mixes' }) },
    { icon: <Playlist size={20} />, label: tr('Playlists'), sub: formatCount(playlists.length), onClick: () => playlists[0] && go({ name: 'playlist', id: playlists[0].id }) },
    { icon: <PlusCircle size={20} />, label: tr('Add music'), sub: tr('Search, links, files'), onClick: () => go({ name: 'add' }) },
  ]
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
      {now && (
        // Open and play / pause side by side: a button can't hold another.
        <div onContextMenu={onMenu(playerMenu)} className="col-span-full flex items-center gap-4 rounded-xl border border-line bg-raised p-2.5 pr-4 transition hover:bg-bg sm:col-span-2">
          <button onClick={() => usePlayer.getState().setFull(true)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
            <Cover title={track?.album ?? now.title} art={track && trackArt(track)} size={56} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="kicker">{playing ? tr('Now playing') : tr('Pick up where you left off')}</span>
              <span className="truncate text-[0.9375rem] font-semibold">{now.title}</span>
              <span className="truncate text-xs text-ink-2">{now.artist}</span>
            </span>
          </button>
          <RoundButton label={playing ? tr('Pause') : tr('Play')} kind="primary" size="md" onClick={() => usePlayer.getState().toggle()}>
            {playing ? <Pause weight="fill" size={16} /> : <Play weight="fill" size={16} />}
          </RoundButton>
        </div>
      )}
      {tiles.map((t) => (
        <button key={t.label} onClick={t.onClick} className="flex items-center gap-3 rounded-xl border border-line bg-raised px-3.5 py-3 text-left transition hover:bg-bg">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-bg text-ink-2">{t.icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[0.8125rem] font-semibold">{t.label}</span>
            <span className="truncate font-mono text-[0.625rem] tracking-[0.06em] text-ink-3 uppercase">{t.sub}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** YouTube Music page of a list (Open in YouTube Music). */
function listUrl(l: ListRef) {
  if (l.type === 'radio') return l.videoId ? `https://music.youtube.com/watch?v=${l.videoId}&list=${l.playlistId}` : `https://music.youtube.com/playlist?list=${l.playlistId}`
  return l.id.startsWith('VL') ? `https://music.youtube.com/playlist?list=${l.id.slice(2)}` : `https://music.youtube.com/browse/${l.id}`
}

/** One shelf of YouTube Music's home: songs play from the row, lists load their songs first. */
function YouTubeShelf({ shelf }: { shelf: Shelf }) {
  const play = usePlayer((s) => s.playTracks)
  const enqueue = usePlayer((s) => s.enqueue)
  const [busy, setBusy] = useState<number | null>(null)
  const songs = useMemo(() => shelf.items.flatMap((it) => (it.track ? [remoteTrack(it.track)] : [])), [shelf])
  const load = async (i: number, list: ListRef) => {
    setBusy(i)
    try {
      return (await api.ytmList(list)).map(remoteTrack)
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
      return []
    } finally {
      setBusy(null)
    }
  }
  const playList = async (i: number, list: ListRef, shuffle = false) => {
    const tracks = await load(i, list)
    if (!tracks.length) return
    usePlayer.setState({ shuffle })
    play(tracks, shuffle ? Math.floor(Math.random() * tracks.length) : 0)
  }
  const card = (it: HomeItem, i: number) => {
    const art = <Cover title={it.title} art={it.art ? [remoteArt(it.art)] : []} size={CARD} className="size-full!" />
    if (it.track) {
      const t = remoteTrack(it.track)
      const at = songs.findIndex((s) => s.id === t.id)
      return <Card key={i} title={it.title} sub={it.subtitle} art={art} onOpen={() => play(songs, at)} onPlay={() => play(songs, at)} menu={() => trackMenu(t, { list: songs, index: at })} />
    }
    const list = it.list!
    const menu = (): MenuEntry[] => [
      { label: tr('Play'), icon: <Play size={16} />, onSelect: () => void playList(i, list) },
      { label: tr('Shuffle play'), onSelect: () => void playList(i, list, true) },
      { label: tr('Add to queue'), onSelect: () => void load(i, list).then((t) => t.length && enqueue(t, false)) },
      '-',
      { label: tr('Open in YouTube Music'), icon: <SourceIcon source="youtube" size={14} />, onSelect: () => void openUrl(listUrl(list)).catch(() => {}) },
    ]
    return <Card key={i} title={it.title} sub={it.subtitle} art={art} busy={busy === i} onOpen={() => void playList(i, list)} onPlay={() => void playList(i, list)} menu={menu} />
  }
  return (
    <Row
      kicker={
        <>
          <SourceIcon source="youtube" size={10} /> {tr('From YouTube Music')}
        </>
      }
      title={shelf.title}
    >
      {shelf.items.map(card)}
    </Row>
  )
}

/** Recommendations of the connected services. Spotify closed its recommendations API to new apps (Nov 2024). */
function ServiceShelves() {
  const youtube = useStore((s) => s.status.youtube.connected)
  const go = useStore((s) => s.go)
  const [shelves, setShelves] = useState<Shelf[] | null>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!youtube) return
    let live = true
    api
      .ytmHome()
      .then((s) => live && setShelves(s))
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [youtube])
  if (!youtube)
    return (
      <div className="flex items-center gap-4 rounded-xl border border-line bg-raised p-4">
        <SourceIcon source="youtube" size={22} />
        <p className="flex-1 text-[0.8125rem] text-ink-2">{tr('Sign in to YouTube Music to see its recommendations here too.')}</p>
        <button onClick={() => go({ name: 'settings', section: 'sources' })} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-bg">
          {tr('Sign in')}
        </button>
      </div>
    )
  if (error) return <p className="text-xs text-ink-3">{tr('YouTube Music recommendations unavailable: {error}', { error })}</p>
  if (!shelves)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <span className="h-5 w-48 animate-pulse rounded bg-raised" />
        <div className="flex gap-5">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="animate-pulse rounded-cover bg-raised" style={{ width: CARD, height: CARD }} />
          ))}
        </div>
      </div>
    )
  return shelves.map((s) => <YouTubeShelf key={s.title} shelf={s} />)
}

export function HomeView() {
  const { tracks, playlists, stats, go } = useStore()
  const hidden = useSettings((s) => s.settings.hiddenPlaylists)
  const { mixes } = useMixes()
  const recent = useMemo(() => tracks.filter((t) => stats[t.id]?.[1]).sort((a, b) => stats[b.id][1] - stats[a.id][1]).slice(0, ROW), [tracks, stats])
  const added = useMemo(() => [...tracks].sort((a, b) => b.added - a.added).slice(0, ROW), [tracks])
  const shown = useMemo(() => playlists.filter((p) => !hidden.includes(playlistKey(p))).slice(0, ROW), [playlists, hidden])
  return (
    <>
      <PageHeader kicker={tr('Home')} title={greeting()} />
      <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto px-2 pb-8">
        <QuickAccess />
        {mixes && mixes.length > 0 && (
          <Row kicker={tr('Made on this PC')} title={tr('Made for you')} action={<SeeAll to={{ name: 'mixes' }} />}>
            {mixes.slice(0, ROW).map((m) => (
              <MixCard key={m.id} mix={m} />
            ))}
          </Row>
        )}
        {recent.length > 0 && (
          <Row title={tr('Recently played')}>
            <TrackCards tracks={recent} />
          </Row>
        )}
        {shown.length > 0 && (
          <Row title={tr('Your playlists')}>
            {shown.map((p) => (
              <Card key={p.id} title={p.name} sub={trn(p.trackCount, '{n} song', '{n} songs')} art={<PlaylistCover p={p} size={CARD} big />} onOpen={() => go({ name: 'playlist', id: p.id })} onPlay={() => void api.playlistTracks(p.id).then((t) => usePlayer.getState().playTracks(t, 0))} />
            ))}
          </Row>
        )}
        <ServiceShelves />
        {added.length > 0 && (
          <Row title={tr('Recently added')} action={<SeeAll to={{ name: 'songs' }} sort="added-new" />}>
            <TrackCards tracks={added} />
          </Row>
        )}
      </div>
    </>
  )
}

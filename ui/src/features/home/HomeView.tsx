import { ArrowDown, ArrowRight, ArrowUp, ArrowUUpLeft, ChartBar, ClockCounterClockwise, DotsSixVertical, EyeSlash, ListPlus, MusicNotes, Play, Playlist, PlusCircle, Shuffle, SlidersHorizontal, Sparkle, YoutubeLogo } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, playlistKey, type HomeItem, type LibraryTrack, type ListRef, type Mix, type Play as PlayRow, type Shelf, type YtmHome } from '../../shared/api'
import { remoteArt, trackArt } from '../../shared/art'
import { locale, msg, tr, trn } from '../../shared/i18n/i18n'
import { onMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { LedChip, RoundButton, Toggle } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'
import { CardRow, MediaCard, Section } from '../../shared/ui/Section'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { moveHome, placeHome, type HomeFilter, type HomeSectionId } from '../../shared/theme/theme'
import { dragSource, useDrag, useDropTarget } from '../../shared/ui/drag'
import { primaryArtist, type Sort } from '../library/filter'
import { PlaylistCover } from '../library/PlaylistCover'
import { playlistMenu, trackMenu, tracksMenu } from '../menus'
import { MixCard, mixSongs, useMixes } from '../mixes/MixesView'
import { mixTitle } from '../mixes/words'
import { remoteTrack, usePlayer } from '../player/store'
import { WaysIn } from '../welcome/WaysIn'
import { jumpLists, useOpenedLists, type OpenedList } from './recentLists'
import { weekOf } from './week'

const ROW = 12

/** YouTube Music's mood chips come in English (requests use hl=en): the interface's language here. */
const MOODS: Record<string, string> = {
  Relax: msg('Relax'),
  Sleep: msg('Sleep'),
  Sad: msg('Sad'),
  Energize: msg('Energize'),
  'Feel good': msg('Feel good'),
  Party: msg('Party'),
  Commute: msg('Commute'),
  Romance: msg('Romance'),
  Focus: msg('Focus'),
  Workout: msg('Workout'),
}

function PlayAll({ tracks }: { tracks: LibraryTrack[] }) {
  return (
    <button onClick={() => usePlayer.getState().playTracks(tracks, 0)} className="flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[0.8125rem] font-medium transition hover:bg-raised">
      <Play size={12} weight="fill" /> {tr('Play all')}
    </button>
  )
}

/** Songs as rows (YouTube Music's Quick picks layout): a click plays the list from there. */
function SongList({ tracks }: { tracks: LibraryTrack[] }) {
  const play = usePlayer((s) => s.playTracks)
  return (
    <ul className="-mx-2 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-4">
      {tracks.map((t, i) => (
        <li key={t.id} onContextMenu={onMenu(() => trackMenu(t, { list: tracks, index: i }))}>
          <button onClick={() => play(tracks, i)} className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised">
            <span className="relative shrink-0">
              <Cover title={t.album ?? t.title} art={trackArt(t)} size={48} />
              <span aria-hidden className="absolute inset-0 grid place-items-center rounded-cover bg-black/45 text-white opacity-0 group-hover:opacity-100">
                <Play weight="fill" size={18} />
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{t.title}</span>
              <span className="truncate text-[0.8125rem] text-ink-2">{t.album ? `${t.artist} · ${t.album}` : t.artist}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Shortcut tile (Media/Tile): cover left, name; play button on hover. */
function JumpTile({ art, title, onOpen, onPlay, menu }: { art: ReactNode; title: string; onOpen: () => void; onPlay: () => void; menu: () => MenuEntry[] }) {
  return (
    <div onContextMenu={onMenu(menu)} className="group flex h-14 items-center gap-3 overflow-hidden rounded-md bg-raised pr-2 transition-colors hover:bg-line">
      <button onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-3 text-left">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden">{art}</span>
        <span className="truncate text-sm font-medium">{title}</span>
      </button>
      <RoundButton label={tr('Play {title}', { title })} kind="primary" size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={onPlay}>
        <Play weight="fill" size={14} />
      </RoundButton>
    </div>
  )
}

/** Shortcut tiles on top of Home: Songs, then the lists opened lately (playlists, albums, artists, mixes), filled from what you played. */
function Shortcuts({ mixes }: { mixes?: Mix[] }) {
  const { tracks, stats, playlists, go } = useStore(useShallow(({ tracks, stats, playlists, go }) => ({ tracks, stats, playlists, go })))
  const opened = useOpenedLists((s) => s.list)
  const play = usePlayer((s) => s.playTracks)
  const lists = useMemo(() => jumpLists(opened, { tracks, stats, playlists, mixIds: mixes?.map((m) => m.id) }), [opened, tracks, stats, playlists, mixes])
  const open = (extra: MenuEntry[], songs: LibraryTrack[]) => (): MenuEntry[] => tracksMenu(songs, ['-', ...extra])
  const tile = (l: OpenedList) => {
    if (l.kind === 'playlist') {
      const p = playlists.find((x) => x.id === l.id)!
      const playIt = () => void api.playlistTracks(p.id).then((t) => play(t, 0))
      const openIt = () => go({ name: 'playlist', id: p.id })
      return <JumpTile key={`p${p.id}`} art={<PlaylistCover p={p} size={56} />} title={p.name} onOpen={openIt} onPlay={playIt} menu={() => [{ label: tr('Play'), icon: <Play size={16} />, onSelect: playIt }, { label: tr('Open'), icon: <ArrowRight size={16} />, onSelect: openIt }]} />
    }
    if (l.kind === 'mix') {
      const m = mixes?.find((x) => x.id === l.id)
      if (!m) return null
      const byId = new Map(tracks.map((t) => [t.id, t]))
      const songs = mixSongs(m, byId)
      const openIt = () => go({ name: 'mix', id: m.id })
      return <JumpTile key={`m${m.id}`} art={<Cover title={mixTitle(m)} art={trackArt(songs[0])} size={56} className="rounded-none! border-0!" />} title={mixTitle(m)} onOpen={openIt} onPlay={() => play(songs, 0)} menu={open([{ label: tr('Open'), icon: <ArrowRight size={16} />, onSelect: openIt }], songs)} />
    }
    const songs = tracks.filter((t) => primaryArtist(t.artist) === l.artist && (l.kind === 'artist' || t.album === l.album))
    if (l.kind === 'album') {
      const openIt = () => go({ name: 'album', album: l.album, artist: l.artist })
      return <JumpTile key={`a${l.album}\u0000${l.artist}`} art={<Cover title={l.album} art={trackArt(songs[0])} size={56} className="rounded-none! border-0!" />} title={l.album} onOpen={openIt} onPlay={() => play(songs, 0)} menu={open([{ label: tr('Open'), icon: <ArrowRight size={16} />, onSelect: openIt }], songs)} />
    }
    const cover = songs.find((t) => t.art) ?? songs[0]
    const openIt = () => go({ name: 'artist', artist: l.artist })
    return <JumpTile key={`r${l.artist}`} art={<Cover title={l.artist} art={trackArt(cover)} size={44} className="rounded-full!" />} title={l.artist} onOpen={openIt} onPlay={() => play(songs, 0)} menu={open([{ label: tr('Open'), icon: <ArrowRight size={16} />, onSelect: openIt }], songs)} />
  }
  const openSongs = () => go({ name: 'songs' })
  // 3 columns × 2 rows as in the mockup; 2 columns when the page is narrow.
  return (
    <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-3">
      <JumpTile
        art={
          <span className="grid size-full place-items-center bg-ink text-bg">
            <MusicNotes size={22} weight="fill" />
          </span>
        }
        title={tr('Songs')}
        onOpen={openSongs}
        onPlay={() => play(tracks, 0)}
        menu={open([{ label: tr('Open'), icon: <ArrowRight size={16} />, onSelect: openSongs }], tracks)}
      />
      {lists.map(tile)}
    </div>
  )
}

/** "2 hr 05 min", "40 min". */
const hours = (ms: number) => {
  const min = Math.round(ms / 60_000)
  return min >= 60 ? tr('{h} hr {m} min', { h: Math.floor(min / 60), m: String(min % 60).padStart(2, '0') }) : tr('{m} min', { m: min })
}

/** The last 7 days from your play history: time heard, per day, your top artist and song. Local only. */
function YourWeek() {
  const tracks = useStore((s) => s.tracks)
  const go = useStore((s) => s.go)
  const [plays, setPlays] = useState<PlayRow[]>()
  useEffect(() => {
    let live = true
    api.recentPlays(Math.floor(Date.now() / 1000) - 14 * 86_400).then(
      (p) => live && setPlays(p),
      () => live && setPlays([]),
    )
    return () => {
      live = false
    }
  }, [])
  const week = useMemo(() => plays && weekOf(plays, tracks), [plays, tracks])
  if (!week) return <span className="h-36 animate-pulse rounded-lg bg-raised" aria-busy />
  if (!week.total) return <p className="text-sm text-ink-2">{tr('Nothing played in the last 7 days. Your listening time shows up here.')}</p>
  const max = Math.max(...week.days)
  const diff = week.total - week.before
  const narrow = new Intl.DateTimeFormat(locale(), { weekday: 'narrow' })
  const long = new Intl.DateTimeFormat(locale(), { weekday: 'long' })
  const { topArtist, topSong } = week
  const same = Math.abs(diff) < 60_000
  const tile = 'flex min-w-0 items-center gap-3 rounded-md border border-line-soft p-3 text-left transition-colors hover:bg-raised'
  // Three blocks centred on one line (user's request 2026-10-23): time, days, then top artist and song share the rest.
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-5 rounded-lg border border-line bg-panel p-5">
      <div className="flex flex-col gap-2">
        <span className="text-[2rem] leading-none font-bold tracking-[-0.01em]">{hours(week.total)}</span>
        {/* Grey either way: sky blue only marks playback (docs/design.md). */}
        <span className="flex w-fit items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-ink-2">
          {!same && (diff > 0 ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />)}
          {same ? tr('Same as last week') : diff > 0 ? tr('{time} more than last week', { time: hours(diff) }) : tr('{time} less than last week', { time: hours(-diff) })}
        </span>
        <span className="text-xs text-ink-3">{tr('About {time} a day', { time: hours(week.total / 7) })}</span>
      </div>
      <ul className="flex h-24 items-end gap-2" aria-label={tr('Time heard per day')}>
        {week.days.map((ms, i) => (
          <li key={i} title={`${long.format(week.starts[i])} · ${hours(ms)}`} className="group flex h-full flex-col items-center justify-end gap-1.5">
            <span className={`w-7 rounded-md transition-colors ${i === 6 ? 'bg-ink' : 'bg-line group-hover:bg-ink-3'}`} style={{ height: Math.max(ms ? 4 : 2, Math.round((ms / max) * 72)) }} />
            <span className={`text-[0.625rem] uppercase ${i === 6 ? 'font-semibold text-ink' : 'text-ink-3'}`}>{narrow.format(week.starts[i])}</span>
          </li>
        ))}
      </ul>
      <div className="grid min-w-0 flex-1 basis-72 grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
        {topArtist && (
          <button onClick={() => go({ name: 'artist', artist: topArtist.name })} onContextMenu={onMenu(() => tracksMenu(tracks.filter((t) => primaryArtist(t.artist) === topArtist.name), [{ label: tr('Go to artist'), onSelect: () => go({ name: 'artist', artist: topArtist.name }) }, '-']))} className={tile}>
            <Cover title={topArtist.name} art={trackArt(topArtist.cover)} size={48} className="rounded-full!" />
            <span className="flex min-w-0 flex-col">
              <span className="text-[0.6875rem] text-ink-3">{tr('Top artist')}</span>
              <span className="truncate text-sm font-semibold">{topArtist.name}</span>
              <span className="text-xs text-ink-2">{hours(topArtist.ms)}</span>
            </span>
          </button>
        )}
        {topSong && (
          <button onClick={() => usePlayer.getState().playTracks([topSong.track], 0)} onContextMenu={onMenu(() => trackMenu(topSong.track))} className={tile}>
            <Cover title={topSong.track.album ?? topSong.track.title} art={trackArt(topSong.track)} size={48} />
            <span className="flex min-w-0 flex-col">
              <span className="text-[0.6875rem] text-ink-3">{tr('Top song')}</span>
              <span className="truncate text-sm font-semibold">{topSong.track.title}</span>
              <span className="truncate text-xs text-ink-2">
                {topSong.track.artist} · {trn(topSong.plays, '{n} play', '{n} plays')}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

/** YouTube Music page of a list (Open in YouTube Music). */
function listUrl(l: ListRef) {
  if (l.type === 'radio') return l.videoId ? `https://music.youtube.com/watch?v=${l.videoId}&list=${l.playlistId}` : `https://music.youtube.com/playlist?list=${l.playlistId}`
  return l.id.startsWith('VL') ? `https://music.youtube.com/playlist?list=${l.id.slice(2)}` : `https://music.youtube.com/browse/${l.id}`
}

/** One shelf of YouTube Music's home (or an artist's page): songs as a list (Quick picks), lists as cards that load their songs first. */
export function YouTubeShelf({ shelf, menu }: { shelf: Shelf; menu?: () => MenuEntry[] }) {
  const play = usePlayer((s) => s.playTracks)
  const enqueue = usePlayer((s) => s.enqueue)
  const [busy, setBusy] = useState<number | null>(null)
  const songs = useMemo(() => shelf.items.flatMap((it) => (it.track ? [remoteTrack(it.track)] : [])), [shelf])
  const sub = (
    <>
      <SourceIcon source="youtube" size={12} /> {tr('From YouTube Music')}
    </>
  )
  if (songs.length === shelf.items.length)
    return (
      <Section title={shelf.title} sub={sub} menu={menu} action={<PlayAll tracks={songs} />}>
        <SongList tracks={songs.slice(0, ROW)} />
      </Section>
    )
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
    const art = <Cover title={it.title} art={it.art ? [remoteArt(it.art)] : []} size={176} />
    if (it.track) {
      const t = remoteTrack(it.track)
      const at = songs.findIndex((s) => s.id === t.id)
      return <MediaCard key={i} title={it.title} sub={it.subtitle} art={art} onOpen={() => play(songs, at)} onPlay={() => play(songs, at)} menu={() => trackMenu(t, { list: songs, index: at })} />
    }
    const list = it.list!
    const entries = (): MenuEntry[] => [
      { label: tr('Play'), icon: <Play size={16} />, onSelect: () => void playList(i, list) },
      { label: tr('Shuffle play'), icon: <Shuffle size={16} />, onSelect: () => void playList(i, list, true) },
      { label: tr('Add to queue'), icon: <ListPlus size={16} />, onSelect: () => void load(i, list).then((t) => t.length && enqueue(t, false)) },
      '-',
      { label: tr('Open in YouTube Music'), icon: <SourceIcon source="youtube" size={14} />, onSelect: () => void openUrl(listUrl(list)).catch(() => {}) },
    ]
    return <MediaCard key={i} title={it.title} sub={it.subtitle} art={art} busy={busy === i} onOpen={() => void playList(i, list)} onPlay={() => void playList(i, list)} menu={entries} />
  }
  return (
    <Section title={shelf.title} sub={sub} menu={menu}>
      <CardRow>{shelf.items.map(card)}</CardRow>
    </Section>
  )
}

/** YouTube Music's home (or a mood of it), once per mood while Home is open; its mood chips from the plain one. */
function useYtmHome(on: boolean, mood: string | null) {
  const [homes, setHomes] = useState<Record<string, YtmHome>>({})
  const [error, setError] = useState<string>()
  const key = mood ?? ''
  useEffect(() => {
    if (!on || homes[key]) return
    let live = true
    api.ytmHome(mood ?? undefined).then(
      (h) => live && setHomes((x) => ({ ...x, [key]: h })),
      (e) => live && setError(String(e)),
    )
    return () => {
      live = false
    }
  }, [on, key])
  return { home: homes[key], moods: homes['']?.moods ?? [], error }
}

/** Recommendations of the connected services. Spotify closed its recommendations API to new apps (Nov 2024). */
function ServiceShelves({ home, error, menu }: { home?: YtmHome; error?: string; menu: () => MenuEntry[] }) {
  if (error) return <p className="text-xs text-ink-3">{tr('YouTube Music recommendations unavailable: {error}', { error })}</p>
  if (!home)
    return (
      <div className="flex flex-col gap-3 overflow-hidden" aria-busy>
        <span className="h-7 w-48 animate-pulse rounded-md bg-raised" />
        <div className="flex gap-6 pt-2">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="size-[176px] shrink-0 animate-pulse rounded-cover bg-raised" />
          ))}
        </div>
      </div>
    )
  return home.shelves.map((s) => <YouTubeShelf key={s.title} shelf={s} menu={menu} />)
}

const sectionLabels: Record<HomeSectionId, string> = {
  quick: msg('Jump back in'),
  week: msg('Your week'),
  mixes: msg('Your mixes'),
  recent: msg('Recently played'),
  playlists: msg('Your playlists'),
  youtube: msg('YouTube Music recommendations'),
  added: msg('Recently added'),
}

const sectionHints: Record<HomeSectionId, string> = {
  quick: msg('Playlists, albums, artists and mixes you opened lately'),
  week: msg('Time heard, top artist and song of the last 7 days'),
  mixes: msg('Made on this PC from what you play'),
  recent: msg('What you played lately'),
  playlists: msg('Your own and imported playlists'),
  youtube: msg('Shelves from YouTube Music, when signed in'),
  added: msg('Newest songs in your library'),
}

const sectionIcons: Record<HomeSectionId, ReactNode> = {
  quick: <ArrowUUpLeft size={18} />,
  week: <ChartBar size={18} />,
  mixes: <Sparkle size={18} />,
  recent: <ClockCounterClockwise size={18} />,
  playlists: <Playlist size={18} />,
  youtube: <YoutubeLogo size={18} />,
  added: <PlusCircle size={18} />,
}

/**
 * Which Home sections show, in what order (settings homeSections): cards dragged into place (user's request
 * 2026-10-22), Alt+↑ / Alt+↓ from the keyboard.
 */
function CustomizeHome({ onClose }: { onClose: () => void }) {
  const list = useSettings((s) => s.settings.homeSections)
  const update = useSettings((s) => s.update)
  useDropTarget('home-sections', {
    accepts: (d) => d.kind === 'home',
    drop: (d, slot) => d.kind === 'home' && slot !== null && update({ homeSections: placeHome(useSettings.getState().settings.homeSections, d.id as HomeSectionId, slot) }),
  })
  const dropAt = useDrag((s) => (s.target === 'home-sections' ? s.slot : null))
  const dragging = useDrag((s) => (s.data?.kind === 'home' ? s.data.id : null))
  return (
    <Dialog title={tr('Customize Home')} onClose={onClose}>
      <p className="-mt-1 mb-3 text-xs text-ink-2">{tr('Drag the cards to change the order. Turn off what you don’t need.')}</p>
      <ul data-drop="home-sections" className="flex flex-col gap-2">
        {list.map((x, i) => (
          <li
            key={x.id}
            data-slot={i}
            onPointerDown={dragSource(
              () => ({ kind: 'home', id: x.id }),
              () => tr(sectionLabels[x.id]),
            )}
            className={`relative flex cursor-grab items-center gap-3 rounded-xl border border-line bg-raised p-2.5 pr-3 transition-[opacity,box-shadow] hover:border-ink-3 active:cursor-grabbing ${dragging === x.id ? 'opacity-40' : ''}`}
          >
            {dropAt === i && <span aria-hidden className="absolute inset-x-2 -top-[5px] h-0.5 rounded-full bg-ink" />}
            {dropAt === i + 1 && i === list.length - 1 && <span aria-hidden className="absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full bg-ink" />}
            <button
              aria-label={tr('Move {section} (Alt+↑ / Alt+↓)', { section: tr(sectionLabels[x.id]) })}
              title={tr('Drag to change the order (Alt+↑ / Alt+↓)')}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                if (!d || !e.altKey) return
                e.preventDefault()
                update({ homeSections: moveHome(list, x.id, d) })
              }}
              className="grid h-9 w-5 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
            >
              <DotsSixVertical size={16} weight="bold" />
            </button>
            <span className={`grid size-9 shrink-0 place-items-center rounded-lg bg-bg ${x.on ? 'text-ink' : 'text-ink-3'}`}>{sectionIcons[x.id]}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[0.8125rem] font-semibold ${x.on ? '' : 'text-ink-3'}`}>{tr(sectionLabels[x.id])}</span>
              <span className="block truncate text-xs text-ink-3">{tr(sectionHints[x.id])}</span>
            </span>
            <span data-nodrag>
              <Toggle label={tr(sectionLabels[x.id])} checked={x.on} onChange={(on) => update({ homeSections: list.map((y) => (y.id === x.id ? { ...y, on } : y)) })} />
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

/**
 * Home: chips on top (everything, your library, YouTube Music, and its moods when signed in; the choice stays), then
 * the sections in the order set in Customize Home. Songs show as rows, lists as cards; each section's ⋮ hides or moves it.
 */
export function HomeView() {
  const { tracks, playlists, stats, go, status } = useStore(useShallow(({ tracks, playlists, stats, go, status }) => ({ tracks, playlists, stats, go, status })))
  const { hiddenPlaylists: hidden, homeSections: sections, homeFilter } = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const [customizing, setCustomizing] = useState(false)
  const [mood, setMood] = useState<string | null>(null)
  const { mixes } = useMixes()
  const ytOn = status.youtube.connected
  const empty = !tracks.length && !playlists.length
  const ytSection = sections.some((x) => x.id === 'youtube' && x.on)
  const yt = useYtmHome(ytOn && ytSection, mood)
  const moods = ytOn && ytSection ? yt.moods.filter((m) => m.title !== 'Podcasts') : []
  // YouTube Music picked, then signed out: everything again.
  const filter: HomeFilter = homeFilter === 'youtube' && !(ytOn && ytSection) ? 'all' : homeFilter
  const visible = (id: HomeSectionId) => (mood ? id === 'youtube' : filter === 'library' ? id !== 'youtube' : filter === 'youtube' ? id === 'youtube' : true)
  const recent = useMemo(() => tracks.filter((t) => stats[t.id]?.[1]).sort((a, b) => stats[b.id][1] - stats[a.id][1]).slice(0, ROW), [tracks, stats])
  const added = useMemo(() => [...tracks].sort((a, b) => b.added - a.added).slice(0, ROW), [tracks])
  const shown = useMemo(() => playlists.filter((p) => !hidden.includes(playlistKey(p))).slice(0, ROW), [playlists, hidden])

  // Moves skip hidden sections: one press = one visible place.
  const menuFor =
    (id: HomeSectionId) =>
    (): MenuEntry[] => {
      const list = useSettings.getState().settings.homeSections
      const i = list.findIndex((x) => x.id === id)
      const up = list.findLastIndex((x, j) => j < i && x.on)
      const down = list.findIndex((x, j) => j > i && x.on)
      return [
        { label: tr('Hide this section'), icon: <EyeSlash size={16} />, onSelect: () => update({ homeSections: list.map((x) => (x.id === id ? { ...x, on: false } : x)) }) },
        { label: tr('Move up'), icon: <ArrowUp size={16} />, disabled: up < 0, onSelect: () => update({ homeSections: placeHome(list, id, up) }) },
        { label: tr('Move down'), icon: <ArrowDown size={16} />, disabled: down < 0, onSelect: () => update({ homeSections: placeHome(list, id, down + 1) }) },
        '-',
        { label: tr('Customize Home'), icon: <SlidersHorizontal size={16} />, onSelect: () => setCustomizing(true) },
      ]
    }
  const pick = (f: HomeFilter) => {
    setMood(null)
    update({ homeFilter: f })
  }

  // Show all: the Songs page sorted that way.
  const songsBy = (sort: Sort) => () => (useStore.getState().setSort(sort), go({ name: 'songs' }))
  const sec: Record<HomeSectionId, () => ReactNode> = {
    quick: () => <Shortcuts mixes={mixes} />,
    week: () => (
      <Section title={tr('Your week')} sub={tr(sectionHints.week)} onAll={() => go({ name: 'stats' })} menu={menuFor('week')}>
        <YourWeek />
      </Section>
    ),
    mixes: () =>
      mixes &&
      mixes.length > 0 && (
        <Section title={tr('Your mixes')} sub={tr(sectionHints.mixes)} onAll={() => go({ name: 'mixes' })} menu={menuFor('mixes')}>
          <CardRow>
            {mixes.slice(0, ROW).map((m) => (
              <MixCard key={m.id} mix={m} />
            ))}
          </CardRow>
        </Section>
      ),
    recent: () =>
      recent.length > 0 && (
        <Section title={tr('Recently played')} sub={tr(sectionHints.recent)} action={<PlayAll tracks={recent} />} onAll={songsBy('recently-played')} menu={menuFor('recent')}>
          <SongList tracks={recent} />
        </Section>
      ),
    playlists: () =>
      shown.length > 0 && (
        <Section title={tr('Your playlists')} sub={tr(sectionHints.playlists)} menu={menuFor('playlists')}>
          <CardRow>
            {shown.map((p) => (
              <MediaCard key={p.id} title={p.name} sub={trn(p.trackCount, '{n} song', '{n} songs')} art={<PlaylistCover p={p} size={176} big />} onOpen={() => go({ name: 'playlist', id: p.id })} onPlay={() => void api.playlistTracks(p.id).then((t) => usePlayer.getState().playTracks(t, 0))} menu={() => playlistMenu(p)} />
            ))}
          </CardRow>
        </Section>
      ),
    youtube: () => ytOn && <ServiceShelves home={yt.home} error={yt.error} menu={menuFor('youtube')} />,
    added: () =>
      added.length > 0 && (
        <Section title={tr('Recently added')} sub={tr(sectionHints.added)} onAll={songsBy('added-new')} menu={menuFor('added')}>
          <SongList tracks={added} />
        </Section>
      ),
  }

  // No page title (mockup): chips, then the shortcut tiles, then the sections.
  return (
    <>
      <div className="flex shrink-0 items-start gap-4 pb-4">
        <div role="tablist" aria-label={tr('Show on Home')} className="flex flex-1 flex-wrap items-center gap-2">
          <LedChip on={!mood && filter === 'all'} label={tr('All')} onClick={() => pick('all')} />
          <LedChip on={!mood && filter === 'library'} label={tr('Your library')} onClick={() => pick('library')} />
          {ytOn && ytSection && <LedChip on={!mood && filter === 'youtube'} label="YouTube Music" onClick={() => pick('youtube')} />}
          {moods.length > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-line" />}
          {moods.map((m) => (
            <LedChip key={m.params} on={mood === m.params} label={tr(MOODS[m.title] ?? m.title)} onClick={() => setMood(mood === m.params ? null : m.params)} />
          ))}
        </div>
        <RoundButton label={tr('Customize Home')} kind="plain" size="sm" onClick={() => setCustomizing(true)}>
          <SlidersHorizontal size={18} />
        </RoundButton>
      </div>
      {/* Cards' padding reaches 12 px out (CardRow): room for it, or the row would scroll the page sideways. */}
      <div className="@container stagger -mx-3 flex min-h-0 flex-1 flex-col gap-5.5 overflow-y-auto px-3 pb-8">
        {/* Nothing in the library yet: the welcome's ways in, first; tiles and a week with nothing in them, not yet. */}
        {empty && (
          <Section title={tr('Bring your music')} sub={tr('Your library is empty')}>
            <WaysIn />
          </Section>
        )}
        {sections
          .filter((x) => (x.on || (mood && x.id === 'youtube')) && visible(x.id) && !(empty && (x.id === 'quick' || x.id === 'week')))
          .map((x) => (
            <Fragment key={x.id}>{sec[x.id]()}</Fragment>
          ))}
        {sections.every((x) => !x.on) && (
          <p className="m-auto text-center text-sm text-ink-2">
            {tr('Every Home section is hidden.')}{' '}
            <button onClick={() => setCustomizing(true)} className="font-semibold text-ink underline-offset-2 hover:underline">
              {tr('Customize Home')}
            </button>
          </p>
        )}
        {/* Signed out: one quiet line at the bottom, not a card in the middle. */}
        {!ytOn && ytSection && filter === 'all' && (
          <p className="flex items-center gap-2 text-xs text-ink-3">
            <SourceIcon source="youtube" size={13} /> {tr('Sign in to YouTube Music to see its recommendations here too.')}
            <button onClick={() => go({ name: 'settings', section: 'sources' })} className="font-semibold text-ink-2 hover:text-ink hover:underline">
              {tr('Sign in')}
            </button>
          </p>
        )}
      </div>
      {customizing && <CustomizeHome onClose={() => setCustomizing(false)} />}
    </>
  )
}

/** Right-click menus, one builder per kind of thing (track, playlist, album, artist, player, app). Built when opened: fresh state. */
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  ArrowsOutSimple,
  ArrowSquareOut,
  Copy,
  Disc,
  DownloadSimple,
  Eye,
  EyeSlash,
  FolderOpen,
  Info,
  Power,
  ImageSquare,
  Gear,
  Link,
  ListPlus,
  MagnifyingGlass,
  MicrophoneStage,
  MinusCircle,
  Pause,
  PencilSimple,
  PictureInPicture,
  Play,
  Playlist,
  Plus,
  PlusCircle,
  Prohibit,
  Queue,
  Repeat,
  ShareNetwork,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  ThumbsDown,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { useSettings } from '../app/settings'
import { useStore } from '../app/store'
import { api, playlistKey, type LibraryPlaylist, type LibraryTrack, type SearchHit } from '../shared/api'
import { bigTrackArt } from '../shared/art'
import { loadFit } from '../shared/artfit'
import { fileName } from '../shared/format'
import { COVER_ORDERS, type PlaylistCover } from '../shared/theme/theme'
import type { MenuEntry } from '../shared/ui/ContextMenu'
import { SourceIcon } from '../shared/ui/SourceIcon'
import type { Addon } from './addons/registry'
import { isOn, setAddon } from './addons/state'
import { addToPlaylist, removeFromPlaylist, songs } from './library/edits'
import { PlaylistCover as PlaylistIcon } from './library/PlaylistCover'
import { primaryArtist } from './library/filter'
import { isFull, viaLabel, vias } from './player/sources'
import { isRemote, nowTrack, usePlayer } from './player/store'

const app = () => useStore.getState()
const player = () => usePlayer.getState()
const fail = (e: unknown) => app().notify(String(e), { kind: 'error' })
const sp = () => app().status.spotify.connected

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => app().notify(`${what} copied`), fail)
}

/** Biggest cover that loads, bars cut like the big cover, to a file the user picks. */
async function saveCover(t: LibraryTrack) {
  let found: { src: string; box: Awaited<ReturnType<typeof loadFit>>['box'] } | undefined
  for (const src of bigTrackArt(t)) {
    try {
      found = { src, box: (await loadFit(src)).box }
      break
    } catch {
      // Next size down.
    }
  }
  if (!found) throw new Error('No cover for this song')
  const path = await save({
    title: 'Save cover',
    defaultPath: `${fileName(`${t.artist} - ${t.title}`)}.jpg`,
    filters: [
      { name: 'JPEG image', extensions: ['jpg'] },
      { name: 'PNG image', extensions: ['png'] },
    ],
  })
  if (!path) return
  const written = await api.exportCover(new URL(found.src).pathname, found.box, path)
  app().notify(`Cover saved: ${written.split(/[\\/]/).pop()}`)
}

const saveCoverItem = (t: LibraryTrack) => bigTrackArt(t).length > 0 && { label: 'Save cover…', icon: <DownloadSimple size={16} />, onSelect: () => void saveCover(t).catch(fail) }

/** Track page on its service, best first. */
function pages(t: LibraryTrack): { label: string; url: string }[] {
  return [
    t.ids.youtube && { label: 'YouTube Music', url: `https://music.youtube.com/watch?v=${t.ids.youtube}` },
    t.ids.apple && { label: 'Apple Music', url: `https://music.apple.com/song/${t.ids.apple}` },
    t.ids.spotify && { label: 'Spotify', url: `https://open.spotify.com/track/${t.ids.spotify}` },
  ].filter((p): p is { label: string; url: string } => !!p)
}

function shufflePlay(tracks: LibraryTrack[]) {
  if (!tracks.length) return
  usePlayer.setState({ shuffle: true })
  player().playTracks(tracks, Math.floor(Math.random() * tracks.length))
}

const hidden = () => new Set(useSettings.getState().settings.hiddenPlaylists)
const setHidden = (key: string, hide: boolean) => {
  const keys = useSettings.getState().settings.hiddenPlaylists.filter((k) => k !== key)
  useSettings.getState().update({ hiddenPlaylists: hide ? [...keys, key] : keys })
}

/** "Add to playlist ›": a new one, your playlists, then your YouTube Music ones (added there too), each with its sidebar icon. Hidden ones left out. */
function addTo(tracks: () => LibraryTrack[] | Promise<LibraryTrack[]>): MenuEntry {
  const add = async (id: number) => addToPlaylist(id, (await tracks()).map((t) => t.id))
  const addYoutube = async (p: LibraryPlaylist) => {
    const ids = (await tracks()).map((t) => t.id)
    if (!ids.length) return
    try {
      const r = await api.addToYoutube(p.id, ids)
      await app().refresh()
      const also = [r.already > 0 && `${r.already} already there`, r.noYoutube > 0 && `${r.noYoutube} with no YouTube version`, r.refused].filter(Boolean).join(' · ')
      const open = { label: 'Open', run: () => app().go({ name: 'playlist', id: p.id }) }
      if (r.added) app().notify(`Added ${r.added === ids.length ? songs(ids) : `${r.added} songs`} to ${p.name} on YouTube Music${also ? ` · ${also}` : ''}`, { action: open })
      else if (r.already) app().notify(`${ids.length === 1 ? 'Already' : 'All already'} in ${p.name}`, { kind: 'info', action: open })
      else app().notify(`Nothing added to ${p.name}: no YouTube version`, { kind: 'info' })
    } catch (e) {
      fail(e)
    }
  }
  const off = hidden()
  const shown = app().playlists.filter((p) => !off.has(playlistKey(p)))
  const youtube = app().status.youtube.connected ? shown.filter((p) => p.source === 'youtube' && !p.custom) : []
  return {
    label: 'Add to playlist',
    icon: <ListPlus size={16} />,
    items: [
      {
        label: 'New playlist…',
        icon: <Plus size={16} />,
        onSelect: async () => {
          const name = prompt('Name of the new playlist', 'New playlist')?.trim()
          if (!name) return
          const id = await app().editPlaylist({ type: 'create', name })
          if (id !== null) await add(id)
        },
      },
      '-',
      ...shown.filter((p) => p.custom).map((p) => ({ label: p.name, icon: <PlaylistIcon p={p} size={16} />, onSelect: () => void add(p.id) })),
      youtube.length > 0 && '-',
      ...youtube.map((p) => ({ label: p.name, icon: <PlaylistIcon p={p} size={16} />, onSelect: () => void addYoutube(p) })),
    ],
  }
}

const orderLabels: Record<PlaylistCover['order'], string> = { playlist: 'Playlist order', recent: 'Recently added', title: 'Title', artist: 'Artist', album: 'Album', duration: 'Longest first' }

/** "Cover ›": service logo, first song, grid of 4, picked image; songs taken in which order. */
function coverMenu(p: LibraryPlaylist): MenuEntry {
  const key = playlistKey(p)
  const cur = useSettings.getState().settings.playlistCovers[key] ?? { mode: 'source', order: 'playlist' }
  const set = (patch: Partial<PlaylistCover>) => {
    const all = useSettings.getState().settings.playlistCovers
    useSettings.getState().update({ playlistCovers: { ...all, [key]: { ...cur, ...patch } } })
  }
  const mode = (m: PlaylistCover['mode'], label: string) => ({ label, checked: cur.mode === m, onSelect: () => set({ mode: m }) })
  return {
    label: 'Cover',
    icon: <ImageSquare size={16} />,
    items: [
      mode('source', p.custom ? 'Playlist icon' : 'Service logo'),
      mode('first', 'First song'),
      mode('grid', 'Grid of 4 songs'),
      {
        label: cur.image ? 'Custom image (change…)' : 'Custom image…',
        checked: cur.mode === 'image',
        onSelect: async () => {
          const path = await open({ title: 'Playlist cover', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
          if (typeof path !== 'string') return
          api.saveCover(p.id, path).then((image) => set({ mode: 'image', image }), fail)
        },
      },
      '-',
      { label: 'Songs taken in', disabled: cur.mode === 'source' || cur.mode === 'image', items: COVER_ORDERS.map((o) => ({ label: orderLabels[o], checked: cur.order === o, onSelect: () => set({ order: o }) })) },
    ],
  }
}

/** Playlists title in the sidebar: new playlist, hidden ones back. */
export function playlistsMenu(): MenuEntry[] {
  const off = hidden()
  const gone = app().playlists.filter((p) => off.has(playlistKey(p)))
  return [
    {
      label: 'New playlist',
      icon: <Plus size={16} />,
      onSelect: async () => {
        const id = await app().editPlaylist({ type: 'create', name: 'New playlist' })
        if (id !== null) app().go({ name: 'playlist', id })
      },
    },
    '-',
    {
      label: `Hidden playlists${gone.length ? ` · ${gone.length}` : ''}`,
      icon: <EyeSlash size={16} />,
      disabled: !gone.length,
      items: [
        ...gone.map((p) => ({ label: p.name, icon: p.custom ? <Playlist size={16} /> : <SourceIcon source={p.source} size={14} />, onSelect: () => setHidden(playlistKey(p), false) })),
        gone.length > 1 && '-',
        gone.length > 1 && { label: 'Show all', icon: <Eye size={16} />, onSelect: () => useSettings.getState().update({ hiddenPlaylists: [] }) },
      ],
    },
  ]
}

function playVia(t: LibraryTrack, list: LibraryTrack[], index: number): MenuEntry {
  const ways = vias(t, sp())
  return ways.length > 1 && { label: 'Play via', icon: <SpeakerHigh size={16} />, items: ways.map((v) => ({ label: viaLabel[v], onSelect: () => player().playTracks(list, index, v) })) }
}

/** ctx.list / index = where it sits (play from there). playlistId + position = custom playlist row. queueIndex = row of the Up next panel. */
/** Recommendation → library (then it can go in playlists). */
const addToLibraryItem = (t: LibraryTrack): MenuEntry => ({
  label: 'Add to library',
  icon: <Plus size={16} />,
  onSelect: () =>
    api
      .addTrack(t)
      .then(() => app().refresh())
      .then(() => app().notify(`Added “${t.title}” to your library`))
      .catch(fail),
})

/** Song from a recommendation (not in the library): play, queue, add, links. */
function remoteMenu(t: LibraryTrack, list: LibraryTrack[], index: number): MenuEntry[] {
  return [
    { label: 'Play', icon: <Play size={16} />, onSelect: () => player().playTracks(list, index) },
    { label: 'Play next', icon: <Queue size={16} />, onSelect: () => player().enqueue([t], true) },
    { label: 'Add to queue', icon: <ListPlus size={16} />, onSelect: () => player().enqueue([t], false) },
    '-',
    addToLibraryItem(t),
    '-',
    pages(t).length > 0 && { label: 'Copy link', icon: <Link size={16} />, onSelect: () => copy(pages(t)[0].url, 'Link') },
    { label: 'Copy title and artist', icon: <Copy size={16} />, onSelect: () => copy(`${t.artist} – ${t.title}`, 'Title') },
    ...pages(t).map((p) => ({ label: `Open in ${p.label}`, icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(p.url).catch(fail) })),
  ]
}

export function trackMenu(t: LibraryTrack, ctx: { list?: LibraryTrack[]; index?: number; playlistId?: number; position?: number; queueIndex?: number } = {}): MenuEntry[] {
  const list = ctx.list ?? [t]
  const index = ctx.index ?? 0
  if (isRemote(t)) return remoteMenu(t, list, index)
  const playable = vias(t, sp()).length > 0
  const go = app().go
  return [
    { label: 'Play', icon: <Play size={16} />, disabled: !playable, onSelect: () => player().playTracks(list, index) },
    { label: 'Play next', icon: <Queue size={16} />, disabled: !playable, onSelect: () => player().enqueue([t], true) },
    { label: 'Add to queue', icon: <ListPlus size={16} />, disabled: !playable, onSelect: () => player().enqueue([t], false) },
    ctx.queueIndex !== undefined && { label: 'Remove from queue', icon: <MinusCircle size={16} />, onSelect: () => player().dequeue(ctx.queueIndex!) },
    playVia(t, list, index),
    '-',
    addTo(() => [t]),
    ctx.playlistId !== undefined && { label: 'Remove from this playlist', icon: <MinusCircle size={16} />, onSelect: () => void removeFromPlaylist(ctx.playlistId!, ctx.position!) },
    '-',
    t.album && { label: 'Go to album', icon: <Disc size={16} />, onSelect: () => go({ name: 'album', album: t.album!, artist: primaryArtist(t.artist) }) },
    { label: 'Go to artist', icon: <MicrophoneStage size={16} />, onSelect: () => go({ name: 'artist', artist: primaryArtist(t.artist) }) },
    !isFull(t, sp()) &&
      app().status.youtube.connected && {
        label: 'Find full version',
        icon: <MagnifyingGlass size={16} />,
        onSelect: () =>
          api
            .findVersions([t.id])
            .then(async (r) => {
              await app().refresh()
              app().notify(r.found ? 'Full version found' : 'No full version found')
            })
            .catch(fail),
      },
    '-',
    {
      label: 'Mixes',
      icon: <ThumbsDown size={16} />,
      items: [
        { label: 'Less like this', icon: <ThumbsDown size={16} />, onSelect: () => api.setTrackPref(t.id, 'less').then(() => app().notify('Less of this in your mixes'), fail) },
        { label: 'Never in mixes', icon: <Prohibit size={16} />, onSelect: () => api.setTrackPref(t.id, 'never').then(() => app().notify('Left out of your mixes'), fail) },
        { label: 'Back to normal', icon: <ArrowCounterClockwise size={16} />, onSelect: () => api.setTrackPref(t.id, null).then(() => app().notify('Mix preference reset'), fail) },
      ],
    },
    '-',
    pages(t).length > 0 && { label: 'Copy link', icon: <Link size={16} />, onSelect: () => copy(pages(t)[0].url, 'Link') },
    { label: 'Copy title and artist', icon: <Copy size={16} />, onSelect: () => copy(`${t.artist} – ${t.title}`, 'Title') },
    saveCoverItem(t),
    ...pages(t).map((p) => ({ label: `Open in ${p.label}`, icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(p.url).catch(fail) })),
    t.ids.local && { label: 'Show in folder', icon: <FolderOpen size={16} />, onSelect: () => revealItemInDir(t.ids.local!).catch(fail) },
  ]
}

/** Catalog search result (Add music). */
export function hitMenu(hit: SearchHit, add: () => void, busy: boolean): MenuEntry[] {
  const t = app().tracks.find((x) => x.id === hit.libraryId)
  if (t) return trackMenu(t)
  const links = pages({ ...hit, id: 0, added: 0 })
  return [
    { label: 'Add to library', icon: <Plus size={16} />, disabled: busy, onSelect: add },
    '-',
    links.length > 0 && { label: 'Copy link', icon: <Link size={16} />, onSelect: () => copy(links[0].url, 'Link') },
    { label: 'Copy title and artist', icon: <Copy size={16} />, onSelect: () => copy(`${hit.artist} – ${hit.title}`, 'Title') },
    ...links.map((p) => ({ label: `Open in ${p.label}`, icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(p.url).catch(fail) })),
  ]
}

/** Several tracks at once (album, artist, mix). */
export function tracksMenu(tracks: LibraryTrack[], extra: MenuEntry[] = []): MenuEntry[] {
  const playable = tracks.some((t) => vias(t, sp()).length > 0)
  return [
    { label: 'Play', icon: <Play size={16} />, disabled: !playable, onSelect: () => player().playTracks(tracks, 0) },
    { label: 'Shuffle play', icon: <Shuffle size={16} />, disabled: !playable, onSelect: () => shufflePlay(tracks) },
    { label: 'Play next', icon: <Queue size={16} />, disabled: !playable, onSelect: () => player().enqueue(tracks, true) },
    { label: 'Add to queue', icon: <ListPlus size={16} />, disabled: !playable, onSelect: () => player().enqueue(tracks, false) },
    '-',
    addTo(() => tracks),
    ...extra,
  ]
}

export function playlistMenu(p: LibraryPlaylist): MenuEntry[] {
  const { go, editPlaylist, notify, status } = app()
  const tracks = () => api.playlistTracks(p.id)
  const ytImport = p.source === 'youtube' && !p.custom
  const remote = ytImport && `https://music.youtube.com/playlist?list=${p.sourceId.split('~')[0]}`
  return [
    { label: 'Play', icon: <Play size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then((t) => player().playTracks(t, 0), fail) },
    { label: 'Shuffle play', icon: <Shuffle size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then(shufflePlay, fail) },
    { label: 'Add to queue', icon: <ListPlus size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then((t) => player().enqueue(t, false), fail) },
    '-',
    { label: 'Open', icon: <Playlist size={16} />, onSelect: () => go({ name: 'playlist', id: p.id }) },
    p.custom && {
      label: 'Rename…',
      icon: <PencilSimple size={16} />,
      onSelect: () => {
        const name = prompt('Rename playlist', p.name)?.trim()
        if (name && name !== p.name) void editPlaylist({ type: 'rename', id: p.id, name })
      },
    },
    {
      label: p.custom ? 'Duplicate' : 'Duplicate as custom playlist',
      icon: <Copy size={16} />,
      onSelect: async () => {
        const id = await editPlaylist({ type: 'duplicate', id: p.id, name: `${p.name} (copy)` })
        if (id !== null) go({ name: 'playlist', id })
      },
    },
    coverMenu(p),
    { label: 'Share…', icon: <ShareNetwork size={16} />, disabled: !p.trackCount, onSelect: () => (go({ name: 'playlist', id: p.id }), useStore.setState({ sharing: p.id })) },
    !ytImport && {
      label: 'Export to YouTube Music',
      icon: <UploadSimple size={16} />,
      disabled: !status.youtube.connected || !p.trackCount,
      onSelect: () =>
        api
          .exportYoutube(p.id)
          .then((r) => notify(`Exported to YouTube Music: ${r.added} added, ${r.already} already there`))
          .catch(fail),
    },
    remote && { label: 'Copy link', icon: <Link size={16} />, onSelect: () => copy(remote, 'Link') },
    remote && { label: 'Open in YouTube Music', icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(remote).catch(fail) },
    '-',
    { label: 'Hide playlist', icon: <EyeSlash size={16} />, onSelect: () => (setHidden(playlistKey(p), true), app().notify(`${p.name} hidden · right-click Playlists to show it again`)) },
    p.custom && {
      label: 'Delete…',
      icon: <Trash size={16} />,
      danger: true,
      onSelect: async () => {
        if (!confirm(`Delete “${p.name}”? The songs stay in your library.`)) return
        await editPlaylist({ type: 'delete', id: p.id })
        const v = app().view
        if (v.name === 'playlist' && v.id === p.id) go({ name: 'songs' })
      },
    },
  ]
}

/** Player surfaces: bar, mini player, Now Playing (like YouTube's own player menu). */
export function playerMenu(): MenuEntry[] {
  const { now, playing, shuffle, repeat, full, positionMs, list, index, toggle, step, toggleShuffle, setFull } = player()
  if (!now) return appMenu()
  const lib = nowTrack()
  // Recommendation playing: not in the library, so no playlist or library actions.
  const t = lib && !isRemote(lib) ? lib : undefined
  const video = now.youtubeId
  const mini = useSettings.getState().settings.miniPlayer
  const rep = (r: typeof repeat, label: string) => ({ label, checked: repeat === r, onSelect: () => usePlayer.setState({ repeat: r }) })
  return [
    { label: playing ? 'Pause' : 'Play', icon: playing ? <Pause size={16} /> : <Play size={16} />, onSelect: toggle },
    { label: 'Previous', icon: <SkipBack size={16} />, onSelect: () => step(-1) },
    { label: 'Next', icon: <SkipForward size={16} />, onSelect: () => step(1) },
    '-',
    { label: 'Shuffle', checked: shuffle, disabled: !now.trackId, onSelect: toggleShuffle },
    { label: 'Repeat', icon: <Repeat size={16} />, disabled: !now.trackId, items: [rep('off', 'Off'), rep('all', 'Whole queue'), rep('one', 'This track')] },
    '-',
    { label: full ? 'Leave full screen' : 'Full screen', icon: <ArrowsOutSimple size={16} />, onSelect: () => setFull(!full) },
    { label: 'Mini player', icon: <PictureInPicture size={16} />, checked: mini || !!video, disabled: !!video, onSelect: () => useSettings.getState().update({ miniPlayer: !mini }) },
    '-',
    t && playVia(t, list, index),
    t && addTo(() => [t]),
    t?.album && { label: 'Go to album', icon: <Disc size={16} />, onSelect: () => (setFull(false), app().go({ name: 'album', album: t.album!, artist: primaryArtist(t.artist) })) },
    t && { label: 'Go to artist', icon: <MicrophoneStage size={16} />, onSelect: () => (setFull(false), app().go({ name: 'artist', artist: primaryArtist(t.artist) })) },
    lib && saveCoverItem(lib),
    lib && isRemote(lib) && addToLibraryItem(lib),
    '-',
    video && { label: 'Copy video URL', icon: <Link size={16} />, onSelect: () => copy(`https://youtu.be/${video}`, 'Video URL') },
    video && { label: 'Copy video URL at current time', icon: <Link size={16} />, onSelect: () => copy(`https://youtu.be/${video}?t=${Math.floor(positionMs / 1000)}`, 'Video URL') },
    video && { label: 'Open on YouTube', icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(`https://www.youtube.com/watch?v=${video}&t=${Math.floor(positionMs / 1000)}s`).catch(fail) },
    now.page && { label: 'Listen on Apple Music', icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(now.page!).catch(fail) },
    now.path && { label: 'Show in folder', icon: <FolderOpen size={16} />, onSelect: () => revealItemInDir(now.path!).catch(fail) },
  ]
}

/** Add-on card. */
export function addonMenu(a: Addon, open: () => void): MenuEntry[] {
  const on = isOn(a.id)
  return [
    { label: on ? 'Turn off' : 'Turn on', icon: <Power size={16} />, onSelect: () => setAddon(a.id, !on) },
    { label: a.settings ? 'Settings…' : 'About…', icon: a.settings ? <Gear size={16} /> : <Info size={16} />, onSelect: open },
  ]
}

/** Anywhere without a menu of its own. */
export function appMenu(): MenuEntry[] {
  const { back, fwd, goBack, goForward, go, sync, editPlaylist, status } = app()
  return [
    { label: 'Back', icon: <ArrowLeft size={16} />, disabled: !back.length, onSelect: goBack },
    { label: 'Forward', icon: <ArrowRight size={16} />, disabled: !fwd.length, onSelect: goForward },
    '-',
    { label: 'Sync library', icon: <ArrowsClockwise size={16} />, disabled: !status.youtube.connected && !status.spotify.connected, onSelect: () => void sync() },
    { label: 'Add music', icon: <PlusCircle size={16} />, onSelect: () => go({ name: 'add' }) },
    {
      label: 'New playlist',
      icon: <Plus size={16} />,
      onSelect: async () => {
        const id = await editPlaylist({ type: 'create', name: 'New playlist' })
        if (id !== null) go({ name: 'playlist', id })
      },
    },
    '-',
    player().now && { label: 'Now playing', icon: <ArrowsOutSimple size={16} />, onSelect: () => player().setFull(true) },
    { label: 'Settings', icon: <Gear size={16} />, onSelect: () => go({ name: 'settings', section: 'appearance' }) },
  ]
}

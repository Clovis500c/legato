/** Right-click menus, one builder per kind of thing (track, playlist, album, artist, player, app). Built when opened: fresh state. */
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  ArrowsOutSimple,
  ArrowSquareOut,
  ClipboardText,
  Copy,
  CopySimple,
  Disc,
  DownloadSimple,
  Eye,
  EyeSlash,
  MusicNotesSimple,
  FolderOpen,
  Info,
  Power,
  ImageSquare,
  Gear,
  Link,
  ListBullets,
  ListPlus,
  MagnifyingGlass,
  MicrophoneStage,
  MinusCircle,
  Moon,
  Pause,
  PencilSimple,
  PictureInPicture,
  Play,
  Playlist,
  Plus,
  PlusCircle,
  Prohibit,
  PuzzlePiece,
  Queue,
  Radio,
  Repeat,
  ShareNetwork,
  Shuffle,
  SlidersHorizontal,
  SortAscending,
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
import { useStore, type SettingsSection, type View } from '../app/store'
import { api, playlistKey, type Edit, type LibraryPlaylist, type PluginInfo, type LibraryTrack, type SearchHit } from '../shared/api'
import { bigTrackArt } from '../shared/art'
import { loadFit } from '../shared/artfit'
import { fileName } from '../shared/format'
import { COVER_ORDERS, type PlaylistCover } from '../shared/theme/theme'
import type { MenuEntry } from '../shared/ui/ContextMenu'
import { SourceIcon } from '../shared/ui/SourceIcon'
import type { Addon } from './addons/registry'
import { isOn, setAddon } from './addons/state'
import { addToPlaylist, markMusic, removeFromPlaylist, removePositions, removeTrackFromPlaylist, songs } from './library/edits'
import { findDuplicates } from './library/DuplicatesDialog'
import { editInfo } from './library/EditInfo'
import { repeatedRows } from './library/duplicates'
import { PlaylistCover as PlaylistIcon } from './library/PlaylistCover'
import { primaryArtist } from './library/filter'
import { isFull, viaLabel, vias } from './player/sources'
import { bypass, deletePreset, deleteVersion, playVersion, reset, useEditor } from './editor/editor'
import { loadPlugins, pluginCommands, runCommand } from './plugins/host'
import { isRemote, nowTrack, remoteTrack, usePlayer } from './player/store'
import { startRadio } from './player/radio'
import { sleepMenu } from './player/sleep'
import { msg, tr, trn } from '../shared/i18n/i18n'
import { ask, askText } from '../shared/ui/Ask'

const app = () => useStore.getState()
const player = () => usePlayer.getState()
const fail = (e: unknown) => app().notify(String(e), { kind: 'error' })
const sp = () => app().status.spotify.connected

function copy(text: string, done: string) {
  navigator.clipboard.writeText(text).then(() => app().notify(done), fail)
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
  if (!found) throw new Error(tr('No cover for this song'))
  const path = await save({
    title: tr('Save cover'),
    defaultPath: `${fileName(`${t.artist} - ${t.title}`)}.jpg`,
    filters: [
      { name: tr('JPEG image'), extensions: ['jpg'] },
      { name: tr('PNG image'), extensions: ['png'] },
    ],
  })
  if (!path) return
  const written = await api.exportCover(new URL(found.src).pathname, found.box, path)
  app().notify(tr('Cover saved: {file}', { file: written.split(/[\\/]/).pop() ?? '' }))
}

const saveCoverItem = (t: LibraryTrack) => bigTrackArt(t).length > 0 && { label: tr('Save cover…'), icon: <DownloadSimple size={16} />, onSelect: () => void saveCover(t).catch(fail) }

/** Track page on its service, best first. */
function pages(t: LibraryTrack): { label: string; url: string }[] {
  return [
    t.ids.youtube && { label: 'YouTube Music', url: `https://music.youtube.com/watch?v=${t.ids.youtube}` },
    t.ids.apple && { label: 'Apple Music', url: `https://music.apple.com/song/${t.ids.apple}` },
    t.ids.spotify && { label: 'Spotify', url: `https://open.spotify.com/track/${t.ids.spotify}` },
  ].filter((p): p is { label: string; url: string } => !!p)
}

/** "Artist – Title" lines, for pasting a list anywhere. */
const copyList = (tracks: LibraryTrack[]) => copy(tracks.map((t) => `${t.artist} – ${t.title}`).join('\n'), trn(tracks.length, '{n} song copied', '{n} songs copied'))

/** Finder and copy for any list of songs (user's request 2026-10-23: duplicate finder from every right-click). */
function listTools(tracks: LibraryTrack[], scope: { name?: string; playlistId?: number } = {}): MenuEntry[] {
  if (tracks.length < 2) return []
  return [
    { label: tr('Find duplicates'), icon: <CopySimple size={16} />, onSelect: () => findDuplicates({ ...scope, ids: tracks.map((t) => t.id) }) },
    { label: tr('Copy song list'), icon: <ClipboardText size={16} />, onSelect: () => copyList(tracks) },
  ]
}

export function shufflePlay(tracks: LibraryTrack[]) {
  if (!tracks.length) return
  usePlayer.setState({ shuffle: true })
  player().playTracks(tracks, Math.floor(Math.random() * tracks.length))
}

const hidden = () => new Set(useSettings.getState().settings.hiddenPlaylists)
const setHidden = (key: string, hide: boolean) => {
  const keys = useSettings.getState().settings.hiddenPlaylists.filter((k) => k !== key)
  useSettings.getState().update({ hiddenPlaylists: hide ? [...keys, key] : keys })
}

/** Adds songs to one of your YouTube Music playlists (there too), with a toast saying what went in. */
async function addToYoutubePlaylist(p: LibraryPlaylist, ids: number[]) {
  if (!ids.length) return
  try {
    const r = await api.addToYoutube(p.id, ids)
    await app().refreshChanged()
    const also = [r.already > 0 && trn(r.already, '{n} already there', '{n} already there'), r.noYoutube > 0 && trn(r.noYoutube, '{n} with no YouTube version', '{n} with no YouTube version')].filter(Boolean).join(' · ')
    const open = { label: tr('Open'), run: () => app().go({ name: 'playlist', id: p.id }) }
    const added = tr('Added to {name} on YouTube Music: {songs}', { name: p.name, songs: r.added === ids.length ? songs(ids) : trn(r.added, '{n} song', '{n} songs') })
    if (r.added) app().notify(added + (also ? ` · ${also}` : ''), { action: open })
    else if (r.already) app().notify(ids.length === 1 ? tr('Already in {name}', { name: p.name }) : tr('All already in {name}', { name: p.name }), { kind: 'info', action: open })
    else app().notify(tr('Nothing added to {name}: no YouTube version', { name: p.name }), { kind: 'info' })
  } catch (e) {
    fail(e)
  }
}

/** Songs dropped on a playlist (sidebar): yours, or a YouTube Music one of yours when signed in. False = can't take them. */
export function canDropOn(p: LibraryPlaylist): boolean {
  return p.custom || (p.source === 'youtube' && app().status.youtube.connected)
}
export function dropOn(p: LibraryPlaylist, ids: number[]) {
  if (p.custom) return void addToPlaylist(p.id, ids)
  if (canDropOn(p)) void addToYoutubePlaylist(p, ids)
}

/**
 * Add to playlist choices: a new one, your playlists, then your YouTube Music ones (added there too), each with its
 * sidebar icon. Hidden ones left out. A submenu of the song menus; the row and Now Playing buttons open it alone.
 */
export function addToItems(ids: () => number[] | Promise<number[]>): MenuEntry[] {
  const add = async (id: number) => addToPlaylist(id, await ids())
  const addYoutube = async (p: LibraryPlaylist) => addToYoutubePlaylist(p, await ids())
  const off = hidden()
  const shown = app().playlists.filter((p) => !off.has(playlistKey(p)))
  const youtube = app().status.youtube.connected ? shown.filter((p) => p.source === 'youtube' && !p.custom) : []
  return [
      {
        label: tr('New playlist…'),
        icon: <Plus size={16} />,
        onSelect: async () => {
          const name = await askText({ title: tr('Name of the new playlist'), ok: tr('Create'), value: tr('New playlist') })
          if (!name) return
          const id = await app().editPlaylist({ type: 'create', name })
          if (id !== null) await add(id)
        },
      },
      '-',
      ...shown.filter((p) => p.custom).map((p) => ({ label: p.name, icon: <PlaylistIcon p={p} size={16} />, onSelect: () => void add(p.id) })),
      youtube.length > 0 && '-',
      ...youtube.map((p) => ({ label: p.name, icon: <PlaylistIcon p={p} size={16} />, onSelect: () => void addYoutube(p) })),
  ]
}

/** "Add to playlist ›". */
function addTo(tracks: () => LibraryTrack[] | Promise<LibraryTrack[]>): MenuEntry {
  return { label: tr('Add to playlist'), icon: <ListPlus size={16} />, items: addToItems(async () => (await tracks()).map((t) => t.id)) }
}

const orderLabels: Record<PlaylistCover['order'], string> = { playlist: msg('Playlist order'), recent: msg('Recently added'), title: msg('Title'), artist: msg('Artist'), album: msg('Album'), duration: msg('Longest first') }

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
    label: tr('Cover'),
    icon: <ImageSquare size={16} />,
    items: [
      mode('source', p.custom ? tr('Playlist icon') : tr('Service logo')),
      mode('first', tr('First song')),
      mode('grid', tr('Grid of 4 songs')),
      {
        label: cur.image ? tr('Custom image (change…)') : tr('Custom image…'),
        checked: cur.mode === 'image',
        onSelect: async () => {
          const path = await open({ title: tr('Playlist cover'), filters: [{ name: tr('Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
          if (typeof path !== 'string') return
          api.saveCover(p.id, path).then((image) => set({ mode: 'image', image }), fail)
        },
      },
      '-',
      { label: tr('Songs taken in'), disabled: cur.mode === 'source' || cur.mode === 'image', items: COVER_ORDERS.map((o) => ({ label: tr(orderLabels[o]), checked: cur.order === o, onSelect: () => set({ order: o }) })) },
    ],
  }
}

/** Playlists title in the sidebar: new playlist, hidden ones back. */
export function playlistsMenu(): MenuEntry[] {
  const off = hidden()
  const gone = app().playlists.filter((p) => off.has(playlistKey(p)))
  return [
    {
      label: tr('New playlist'),
      icon: <Plus size={16} />,
      onSelect: async () => {
        const id = await app().editPlaylist({ type: 'create', name: tr('New playlist') })
        if (id !== null) app().go({ name: 'playlist', id })
      },
    },
    '-',
    {
      label: tr('Hidden playlists') + (gone.length ? ` · ${gone.length}` : ''),
      icon: <EyeSlash size={16} />,
      disabled: !gone.length,
      items: [
        ...gone.map((p) => ({ label: p.name, icon: p.custom ? <Playlist size={16} /> : <SourceIcon source={p.source} size={14} />, onSelect: () => setHidden(playlistKey(p), false) })),
        gone.length > 1 && '-',
        gone.length > 1 && { label: tr('Show all'), icon: <Eye size={16} />, onSelect: () => useSettings.getState().update({ hiddenPlaylists: [] }) },
      ],
    },
  ]
}

function playVia(t: LibraryTrack, list: LibraryTrack[], index: number): MenuEntry {
  const ways = vias(t, sp())
  return ways.length > 1 && { label: tr('Play via'), icon: <SpeakerHigh size={16} />, items: ways.map((v) => ({ label: tr(viaLabel[v]), onSelect: () => player().playTracks(list, index, v) })) }
}

/** Library row of a recommendation once added (same YouTube, Apple or Spotify id), else the song itself. */
function ownOf(t: LibraryTrack): LibraryTrack {
  if (!isRemote(t)) return t
  const same = (x: LibraryTrack) => (['youtube', 'apple', 'spotify'] as const).some((s) => t.ids[s] && x.ids[s] === t.ids[s])
  return app().tracks.find(same) ?? t
}

/** Recommendation → library (then it can go in playlists). */
const addToLibraryItem = (t: LibraryTrack): MenuEntry => ({
  label: tr('Add to library'),
  icon: <Plus size={16} />,
  onSelect: () =>
    api
      .addTrack(t)
      .then(() => app().refreshChanged())
      .then(() => app().notify(tr('Added “{title}” to your library', { title: t.title })))
      .catch(fail),
})

/** Song from a recommendation (not in the library): play, queue, add, links. */
function remoteMenu(t: LibraryTrack, list: LibraryTrack[], index: number): MenuEntry[] {
  return [
    { label: tr('Play'), icon: <Play size={16} />, onSelect: () => player().playTracks(list, index) },
    { label: tr('Play next'), icon: <Queue size={16} />, onSelect: () => player().enqueue([t], true) },
    { label: tr('Add to queue'), icon: <ListPlus size={16} />, onSelect: () => player().enqueue([t], false) },
    { label: tr('Start radio'), icon: <Radio size={16} />, onSelect: () => void startRadio(t) },
    '-',
    addToLibraryItem(t),
    '-',
    pages(t).length > 0 && { label: tr('Copy link'), icon: <Link size={16} />, onSelect: () => copy(pages(t)[0].url, tr('Link copied')) },
    { label: tr('Copy title and artist'), icon: <Copy size={16} />, onSelect: () => copy(`${t.artist} – ${t.title}`, tr('Title and artist copied')) },
    ...pages(t).map((p) => ({ label: tr('Open in {service}', { service: p.label }), icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(p.url).catch(fail) })),
  ]
}

/**
 * "Remove from ›": every playlist holding the song (yours here, YouTube Music ones on the account, Liked Music = the
 * like goes; Spotify imports are read-only), then the whole library.
 */
function removeFrom(t: LibraryTrack): MenuEntry {
  const { playlists, orders, status } = app()
  const holding = playlists.filter((p) => orders[p.id]?.includes(t.id))
  const fromYoutube = async (p: LibraryPlaylist) => {
    try {
      await api.removeFromPlaylist(p.id, t.id)
      await app().refreshChanged()
      const undo = () => void api.addToYoutube(p.id, [t.id]).then(() => app().refreshChanged()).catch(fail)
      app().notify(tr('Removed from {name} on YouTube Music: {songs}', { name: p.name, songs: songs([t.id]) }), { kind: 'removed', action: { label: tr('Undo'), run: undo } })
    } catch (e) {
      fail(e)
    }
  }
  const fromLibrary = async () => {
    const ok = await ask({ title: tr('Remove “{title}” from your library?', { title: t.title }), body: tr('It also leaves every playlist in Legato. Your YouTube Music and Spotify playlists keep it, and syncs won’t bring it back here. Files on disk stay where they are.'), ok: tr('Remove') })
    if (!ok) return
    try {
      await api.removeFromLibrary(t.id)
      await app().refreshChanged()
      app().notify(tr('Removed “{title}” from your library', { title: t.title }), { kind: 'removed' })
    } catch (e) {
      fail(e)
    }
  }
  return {
    label: tr('Remove from'),
    icon: <MinusCircle size={16} />,
    items: [
      ...holding.map((p) => {
        const youtube = !p.custom && p.source === 'youtube'
        return {
          label: p.custom || youtube ? p.name : tr('{name} (read-only)', { name: p.name }),
          icon: <PlaylistIcon p={p} size={16} />,
          disabled: !p.custom && (!youtube || !status.youtube.connected),
          onSelect: () => void (p.custom ? removeTrackFromPlaylist(p.id, t.id) : fromYoutube(p)),
        }
      }),
      holding.length > 0 && '-',
      { label: tr('Library…'), icon: <Trash size={16} />, danger: true, onSelect: () => void fromLibrary() },
    ],
  }
}

/** ctx.list / index = where it sits (play from there). playlistId + position = custom playlist row. queueIndex = row of the Up next panel. */
export function trackMenu(t: LibraryTrack, ctx: { list?: LibraryTrack[]; index?: number; playlistId?: number; position?: number; queueIndex?: number } = {}): MenuEntry[] {
  const list = ctx.list ?? [t]
  const index = ctx.index ?? 0
  // Added since: library actions (playlists) from now on.
  t = ownOf(t)
  if (isRemote(t)) return remoteMenu(t, list, index)
  const playable = vias(t, sp()).length > 0
  const go = app().go
  return [
    { label: tr('Play'), icon: <Play size={16} />, disabled: !playable, onSelect: () => player().playTracks(list, index) },
    { label: tr('Play next'), icon: <Queue size={16} />, disabled: !playable, onSelect: () => player().enqueue([t], true) },
    { label: tr('Add to queue'), icon: <ListPlus size={16} />, disabled: !playable, onSelect: () => player().enqueue([t], false) },
    ctx.queueIndex !== undefined && { label: tr('Remove from queue'), icon: <MinusCircle size={16} />, onSelect: () => player().dequeue(ctx.queueIndex!) },
    playVia(t, list, index),
    playable && { label: tr('Start radio'), icon: <Radio size={16} />, onSelect: () => void startRadio(t) },
    '-',
    addTo(() => [t]),
    ctx.playlistId !== undefined && { label: tr('Remove from this playlist'), icon: <MinusCircle size={16} />, onSelect: () => void removeFromPlaylist(ctx.playlistId!, ctx.position!) },
    removeFrom(t),
    '-',
    t.album && { label: tr('Go to album'), icon: <Disc size={16} />, onSelect: () => go({ name: 'album', album: t.album!, artist: primaryArtist(t.artist) }) },
    { label: tr('Go to artist'), icon: <MicrophoneStage size={16} />, onSelect: () => go({ name: 'artist', artist: primaryArtist(t.artist) }) },
    !isFull(t, sp()) &&
      app().status.youtube.connected && {
        label: tr('Find full version'),
        icon: <MagnifyingGlass size={16} />,
        onSelect: () =>
          api
            .findVersions([t.id])
            .then(async (r) => {
              await app().refreshChanged()
              app().notify(r.found ? tr('Full version found') : tr('No full version found'))
            })
            .catch(fail),
      },
    '-',
    {
      label: tr('Mixes'),
      icon: <ThumbsDown size={16} />,
      items: [
        { label: tr('Less like this'), icon: <ThumbsDown size={16} />, onSelect: () => api.setTrackPref(t.id, 'less').then(() => app().notify(tr('Less of this in your mixes')), fail) },
        { label: tr('Never in mixes'), icon: <Prohibit size={16} />, onSelect: () => api.setTrackPref(t.id, 'never').then(() => app().notify(tr('Left out of your mixes')), fail) },
        { label: tr('Back to normal'), icon: <ArrowCounterClockwise size={16} />, onSelect: () => api.setTrackPref(t.id, null).then(() => app().notify(tr('Mix preference reset')), fail) },
      ],
    },
    // Music or not, the user's word over the app's guess (hidden videos fold).
    t.musicness === 'notMusic'
      ? { label: tr('It’s music'), icon: <MusicNotesSimple size={16} />, onSelect: () => void markMusic([t.id], true) }
      : { label: tr('Not music: hide it'), icon: <EyeSlash size={16} />, onSelect: () => void markMusic([t.id], false) },
    '-',
    pages(t).length > 0 && { label: tr('Copy link'), icon: <Link size={16} />, onSelect: () => copy(pages(t)[0].url, tr('Link copied')) },
    { label: tr('Copy title and artist'), icon: <Copy size={16} />, onSelect: () => copy(`${t.artist} – ${t.title}`, tr('Title and artist copied')) },
    saveCoverItem(t),
    ...pages(t).map((p) => ({ label: tr('Open in {service}', { service: p.label }), icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(p.url).catch(fail) })),
    t.ids.local && { label: tr('Edit song info…'), icon: <PencilSimple size={16} />, onSelect: () => editInfo(t) },
    t.ids.local && { label: tr('Show in folder'), icon: <FolderOpen size={16} />, onSelect: () => revealItemInDir(t.ids.local!).catch(fail) },
    list.length > 1 && {
      label: tr('This list'),
      icon: <ListBullets size={16} />,
      items: [
        { label: tr('Play all'), icon: <Play size={16} />, onSelect: () => player().playTracks(list, 0) },
        { label: tr('Shuffle play'), icon: <Shuffle size={16} />, onSelect: () => shufflePlay(list) },
        ...listTools(list, { playlistId: ctx.playlistId, name: app().playlists.find((p) => p.id === ctx.playlistId)?.name }),
      ],
    },
    ...pluginItems('track', { trackId: t.id, title: t.title, artist: t.artist }),
  ]
}

/** Menu items plugins added for this place, after a separator. */
function pluginItems(where: 'track' | 'playlist' | 'player', context: Record<string, unknown>): MenuEntry[] {
  const items = pluginCommands(where)
  if (!items.length) return []
  return ['-', ...items.map(({ plugin, command }) => ({ label: command.title, icon: <PuzzlePiece size={16} />, onSelect: () => runCommand(plugin, command.id, context) }))]
}

/** A third-party plugin's card (Add-ons). */
export function pluginMenu(p: PluginInfo, about: () => void): MenuEntry[] {
  const name = p.manifest?.name ?? p.id
  return [
    { label: p.on ? tr('Turn off') : tr('Turn on'), icon: <Power size={16} />, onSelect: () => void api.pluginSet(p.id, !p.on).then(loadPlugins, fail) },
    { label: tr('About…'), icon: <Info size={16} />, onSelect: about },
    { label: tr('Show in folder'), icon: <FolderOpen size={16} />, onSelect: () => revealItemInDir(p.folder).catch(fail) },
    '-',
    {
      label: tr('Uninstall {name}', { name }),
      icon: <Trash size={16} />,
      danger: true,
      onSelect: () => void api.pluginUninstall(p.id).then(() => (loadPlugins(), app().notify(tr('{name} uninstalled', { name }), { kind: 'removed' })), fail),
    },
  ]
}

/** Catalog search result (Add music). */
export function hitMenu(hit: SearchHit, add: () => void, busy: boolean, play: () => void): MenuEntry[] {
  const item = remoteTrack(hit)
  // In the library (added here or before): its menu, playlists included.
  const t = app().tracks.find((x) => x.id === hit.libraryId) ?? ownOf(item)
  if (!isRemote(t)) return trackMenu(t)
  const links = pages({ ...hit, id: 0, added: 0 })
  return [
    { label: tr('Play'), icon: <Play size={16} />, onSelect: play },
    { label: tr('Play next'), icon: <Queue size={16} />, onSelect: () => player().enqueue([item], true) },
    { label: tr('Add to queue'), icon: <ListPlus size={16} />, onSelect: () => player().enqueue([item], false) },
    '-',
    { label: tr('Add to library'), icon: <Plus size={16} />, disabled: busy, onSelect: add },
    '-',
    links.length > 0 && { label: tr('Copy link'), icon: <Link size={16} />, onSelect: () => copy(links[0].url, tr('Link copied')) },
    { label: tr('Copy title and artist'), icon: <Copy size={16} />, onSelect: () => copy(`${hit.artist} – ${hit.title}`, tr('Title and artist copied')) },
    ...links.map((p) => ({ label: tr('Open in {service}', { service: p.label }), icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(p.url).catch(fail) })),
  ]
}

/** Several tracks at once (album, artist, mix). */
export function tracksMenu(tracks: LibraryTrack[], extra: MenuEntry[] = []): MenuEntry[] {
  const playable = tracks.some((t) => vias(t, sp()).length > 0)
  return [
    { label: tr('Play'), icon: <Play size={16} />, disabled: !playable, onSelect: () => player().playTracks(tracks, 0) },
    { label: tr('Shuffle play'), icon: <Shuffle size={16} />, disabled: !playable, onSelect: () => shufflePlay(tracks) },
    { label: tr('Play next'), icon: <Queue size={16} />, disabled: !playable, onSelect: () => player().enqueue(tracks, true) },
    { label: tr('Add to queue'), icon: <ListPlus size={16} />, disabled: !playable, onSelect: () => player().enqueue(tracks, false) },
    '-',
    addTo(() => tracks),
    ...extra,
    '-',
    ...listTools(tracks),
  ]
}

export function playlistMenu(p: LibraryPlaylist): MenuEntry[] {
  const { go, editPlaylist, notify, status } = app()
  const tracks = () => api.playlistTracks(p.id)
  const ytImport = p.source === 'youtube' && !p.custom
  const remote = ytImport && `https://music.youtube.com/playlist?list=${p.sourceId.split('~')[0]}`
  return [
    { label: tr('Play'), icon: <Play size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then((t) => player().playTracks(t, 0), fail) },
    { label: tr('Shuffle play'), icon: <Shuffle size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then(shufflePlay, fail) },
    { label: tr('Play next'), icon: <Queue size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then((t) => player().enqueue(t, true), fail) },
    { label: tr('Add to queue'), icon: <ListPlus size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then((t) => player().enqueue(t, false), fail) },
    '-',
    { label: tr('Open'), icon: <Playlist size={16} />, onSelect: () => go({ name: 'playlist', id: p.id }) },
    { label: tr('Find duplicates'), icon: <CopySimple size={16} />, disabled: p.trackCount < 2, onSelect: () => tracks().then((t) => findDuplicates({ name: p.name, ids: t.map((x) => x.id), playlistId: p.id }), fail) },
    p.custom &&
      repeatedRows(app().orders[p.id] ?? []).length > 0 && {
        label: tr('Remove repeated songs'),
        icon: <MinusCircle size={16} />,
        onSelect: () => void removePositions(p.id, repeatedRows(app().orders[p.id] ?? [])),
      },
    { label: tr('Copy song list'), icon: <ClipboardText size={16} />, disabled: !p.trackCount, onSelect: () => tracks().then(copyList, fail) },
    { label: tr('Copy name'), icon: <Copy size={16} />, onSelect: () => copy(p.name, tr('Name copied')) },
    p.custom && {
      label: tr('Rename…'),
      icon: <PencilSimple size={16} />,
      onSelect: async () => {
        const name = await askText({ title: tr('Rename playlist'), ok: tr('Rename'), value: p.name })
        if (name && name !== p.name) void editPlaylist({ type: 'rename', id: p.id, name })
      },
    },
    {
      label: p.custom ? tr('Duplicate') : tr('Duplicate as custom playlist'),
      icon: <Copy size={16} />,
      onSelect: async () => {
        const id = await editPlaylist({ type: 'duplicate', id: p.id, name: tr('{name} (copy)', { name: p.name }) })
        if (id !== null) go({ name: 'playlist', id })
      },
    },
    coverMenu(p),
    { label: tr('Share…'), icon: <ShareNetwork size={16} />, disabled: !p.trackCount, onSelect: () => (go({ name: 'playlist', id: p.id }), useStore.setState({ sharing: p.id })) },
    !ytImport && {
      label: tr('Export to YouTube Music'),
      icon: <UploadSimple size={16} />,
      disabled: !status.youtube.connected || !p.trackCount,
      onSelect: () =>
        api
          .exportYoutube(p.id)
          .then((r) => notify(tr('Exported to YouTube Music: {added} added, {already} already there', { added: r.added, already: r.already })))
          .catch(fail),
    },
    // Services give no dates: "date added" sorts follow the end new songs land on.
    !p.custom && {
      label: tr('Date added order'),
      icon: <SortAscending size={16} />,
      items: [
        { label: tr('Learned from syncs'), checked: !p.orderManual, onSelect: () => void editPlaylist({ type: 'setOrder', id: p.id, newestFirst: null }) },
        { label: tr('Newest songs at the top'), checked: p.orderManual && p.newestFirst, onSelect: () => void editPlaylist({ type: 'setOrder', id: p.id, newestFirst: true }) },
        { label: tr('Newest songs at the bottom'), checked: p.orderManual && !p.newestFirst, onSelect: () => void editPlaylist({ type: 'setOrder', id: p.id, newestFirst: false }) },
      ],
    },
    remote && { label: tr('Copy link'), icon: <Link size={16} />, onSelect: () => copy(remote, tr('Link copied')) },
    remote && { label: tr('Open in YouTube Music'), icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(remote).catch(fail) },
    '-',
    { label: tr('Hide playlist'), icon: <EyeSlash size={16} />, onSelect: () => (setHidden(playlistKey(p), true), app().notify(tr('{name} hidden · right-click Playlists to show it again', { name: p.name }))) },
    p.custom && {
      label: tr('Delete…'),
      icon: <Trash size={16} />,
      danger: true,
      onSelect: async () => {
        if (!(await ask({ title: tr('Delete “{name}”?', { name: p.name }), body: tr('The songs stay in your library.'), ok: tr('Delete') }))) return
        await editPlaylist({ type: 'delete', id: p.id })
        const v = app().view
        if (v.name === 'playlist' && v.id === p.id) go({ name: 'songs' })
      },
    },
    ...pluginItems('playlist', { playlistId: p.id, name: p.name }),
  ]
}

const SECTIONS: [SettingsSection, string][] = [
  ['general', msg('General')],
  ['playback', msg('Playback')],
  ['appearance', msg('Appearance')],
  ['sources', msg('Accounts')],
  ['sync', msg('Sync Mode')],
  ['shield', msg('Shield')],
  ['shortcuts', msg('Shortcuts')],
  ['about', msg('About')],
]

/** Sidebar entries (Home, Songs, Settings…): open it; its songs when it has some; settings sections; counts on/off. */
export function navMenu(to: View, tracks?: LibraryTrack[]): MenuEntry[] {
  const { go } = app()
  const { settings, update } = useSettings.getState()
  return [
    { label: tr('Open'), icon: <ArrowSquareOut size={16} />, onSelect: () => go(to) },
    to.name === 'settings' && { label: tr('Go to'), icon: <Gear size={16} />, items: SECTIONS.map(([section, label]) => ({ label: tr(label), onSelect: () => go({ name: 'settings', section }) })) },
    '-',
    ...(tracks?.length ? tracksMenu(tracks) : []),
    '-',
    { label: tr('Counts in the sidebar'), checked: settings.sidebarCounts, onSelect: () => update({ sidebarCounts: !settings.sidebarCounts }) },
  ]
}

/** Player surfaces: bar, mini player, Now Playing (like YouTube's own player menu). */
export function playerMenu(): MenuEntry[] {
  const { now, playing, shuffle, repeat, full, positionMs, list, index, toggle, step, toggleShuffle, setFull } = player()
  if (!now) return appMenu()
  const playingNow = nowTrack()
  const lib = playingNow && ownOf(playingNow)
  // Recommendation playing: not in the library, so no playlist or library actions.
  const t = lib && !isRemote(lib) ? lib : undefined
  const video = now.youtubeId
  const mini = useSettings.getState().settings.miniPlayer
  const rep = (r: typeof repeat, label: string) => ({ label, checked: repeat === r, onSelect: () => usePlayer.setState({ repeat: r }) })
  return [
    { label: playing ? tr('Pause') : tr('Play'), icon: playing ? <Pause size={16} /> : <Play size={16} />, onSelect: toggle },
    { label: tr('Previous'), icon: <SkipBack size={16} />, onSelect: () => step(-1) },
    { label: tr('Next'), icon: <SkipForward size={16} />, onSelect: () => step(1) },
    '-',
    { label: tr('Shuffle'), checked: shuffle, disabled: !now.trackId, onSelect: toggleShuffle },
    { label: tr('Repeat'), icon: <Repeat size={16} />, disabled: !now.trackId, items: [rep('off', tr('Off')), rep('all', tr('Whole queue')), rep('one', tr('This track'))] },
    '-',
    { label: full ? tr('Leave full screen') : tr('Full screen'), icon: <ArrowsOutSimple size={16} />, onSelect: () => setFull(!full) },
    { label: tr('Live Editor'), icon: <SlidersHorizontal size={16} />, onSelect: () => (useSettings.getState().update({ editor: true }), setFull(true)) },
    { label: tr('Sleep timer'), icon: <Moon size={16} />, items: sleepMenu() },
    { label: tr('Mini player'), icon: <PictureInPicture size={16} />, checked: mini || !!video, disabled: !!video, onSelect: () => useSettings.getState().update({ miniPlayer: !mini }) },
    '-',
    t && playVia(t, list, index),
    t && addTo(() => [t]),
    t?.album && { label: tr('Go to album'), icon: <Disc size={16} />, onSelect: () => (setFull(false), app().go({ name: 'album', album: t.album!, artist: primaryArtist(t.artist) })) },
    t && { label: tr('Go to artist'), icon: <MicrophoneStage size={16} />, onSelect: () => (setFull(false), app().go({ name: 'artist', artist: primaryArtist(t.artist) })) },
    lib && saveCoverItem(lib),
    lib && isRemote(lib) && addToLibraryItem(lib),
    '-',
    video && { label: tr('Copy video URL'), icon: <Link size={16} />, onSelect: () => copy(`https://youtu.be/${video}`, tr('Video URL copied')) },
    video && { label: tr('Copy video URL at current time'), icon: <Link size={16} />, onSelect: () => copy(`https://youtu.be/${video}?t=${Math.floor(positionMs / 1000)}`, tr('Video URL copied')) },
    video && { label: tr('Open on YouTube'), icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(`https://www.youtube.com/watch?v=${video}&t=${Math.floor(positionMs / 1000)}s`).catch(fail) },
    now.page && { label: tr('Listen on Apple Music'), icon: <ArrowSquareOut size={16} />, onSelect: () => openUrl(now.page!).catch(fail) },
    now.path && { label: tr('Show in folder'), icon: <FolderOpen size={16} />, onSelect: () => revealItemInDir(now.path!).catch(fail) },
    ...pluginItems('player', { trackId: t?.id ?? null, title: now.title, artist: now.artist }),
  ]
}

/** Live Editor panel. */
export function editorMenu(hide: () => void): MenuEntry[] {
  const { effects } = useEditor.getState()
  return [
    { label: tr('Hear the changes'), checked: effects.on, onSelect: () => bypass(!effects.on) },
    { label: tr('Reset all'), icon: <ArrowCounterClockwise size={16} />, onSelect: reset },
    '-',
    { label: tr('Hide the Live Editor'), icon: <EyeSlash size={16} />, onSelect: hide },
  ]
}

/** A saved version of the playing song. */
export function editVersionMenu(v: Edit, rename: () => void): MenuEntry[] {
  return [
    { label: tr('Play with this song'), icon: <Play size={16} />, checked: v.active, onSelect: () => playVersion(v.id).catch(fail) },
    { label: tr('Rename'), icon: <PencilSimple size={16} />, onSelect: rename },
    '-',
    { label: tr('Delete'), icon: <Trash size={16} />, danger: true, onSelect: () => deleteVersion(v.id).catch(fail) },
  ]
}

/** A Live Editor preset: built in (no id) or saved. */
export function editPresetMenu(name: string, apply: () => void, id?: number): MenuEntry[] {
  return [{ label: tr('Apply “{name}”', { name }), icon: <SlidersHorizontal size={16} />, onSelect: apply }, id !== undefined && '-', id !== undefined && { label: tr('Delete'), icon: <Trash size={16} />, danger: true, onSelect: () => deletePreset(id).catch(fail) }]
}

/** Add-on card. */
export function addonMenu(a: Addon, open: () => void): MenuEntry[] {
  const on = isOn(a.id)
  return [
    { label: on ? tr('Turn off') : tr('Turn on'), icon: <Power size={16} />, onSelect: () => setAddon(a.id, !on) },
    { label: a.settings ? tr('Settings…') : tr('About…'), icon: a.settings ? <Gear size={16} /> : <Info size={16} />, onSelect: open },
  ]
}

/** Anywhere without a menu of its own. */
export function appMenu(): MenuEntry[] {
  const { back, fwd, goBack, goForward, go, sync, editPlaylist, status } = app()
  return [
    { label: tr('Back'), icon: <ArrowLeft size={16} />, disabled: !back.length, onSelect: goBack },
    { label: tr('Forward'), icon: <ArrowRight size={16} />, disabled: !fwd.length, onSelect: goForward },
    '-',
    { label: tr('Sync library'), icon: <ArrowsClockwise size={16} />, disabled: !status.youtube.connected && !status.spotify.connected, onSelect: () => void sync() },
    { label: tr('Add music'), icon: <PlusCircle size={16} />, onSelect: () => go({ name: 'add' }) },
    {
      label: tr('New playlist'),
      icon: <Plus size={16} />,
      onSelect: async () => {
        const id = await editPlaylist({ type: 'create', name: tr('New playlist') })
        if (id !== null) go({ name: 'playlist', id })
      },
    },
    '-',
    player().now && { label: tr('Now playing'), icon: <ArrowsOutSimple size={16} />, onSelect: () => player().setFull(true) },
    { label: tr('Settings'), icon: <Gear size={16} />, onSelect: () => go({ name: 'settings', section: 'general' }) },
  ]
}

import { create } from 'zustand'
import { api, type Credentials, type LibraryPlaylist, type LibraryTrack, type PlaylistEdit, type Service, type SourceStatus, type SpotifyProgress, type SpotifyLibraryImport, type SyncReport, type Track } from '../shared/api'
import type { Filter, GroupSize, GroupSort, PlayStats, Sort } from '../features/library/filter'
import { explain } from '../shared/errors'
import { soundcloudLink, starsText } from '../shared/format'
import { tr, trn } from '../shared/i18n/i18n'
import { noteList } from '../features/home/recentLists'
import { advance, BEAT, newRun, summary, type ImportKind, type ImportRun } from '../features/add/importRun'
import { patchLibrary } from './libraryPatch'
import { fold, oneLiked, ownLiked, shownIds, youtubeLiked, type Lists } from '../features/library/likedMusic'

export type SettingsSection = 'general' | 'playback' | 'appearance' | 'sources' | 'sync' | 'shield' | 'privacy' | 'shortcuts' | 'about'

export type View =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'search' }
  | { name: 'addons' }
  | { name: 'mixes' }
  | { name: 'stats' }
  | { name: 'smart'; id: string }
  | { name: 'notFound' }
  | { name: 'health' }
  | { name: 'mix'; id: string }
  | { name: 'songs' }
  | { name: 'albums' }
  | { name: 'album'; album: string; artist: string }
  | { name: 'artists' }
  | { name: 'artist'; artist: string }
  | { name: 'playlist'; id: number }
  /** focus = setting label to scroll to and highlight (settings search). */
  | { name: 'settings'; section: SettingsSection; wizard?: 'spotify'; focus?: string }

/** Short message in the corner. kind picks the icon; action = one button (Undo, Open…). */
export interface Toast {
  id: number
  text: string
  kind: 'ok' | 'removed' | 'info' | 'error'
  action?: { label: string; run: () => void }
}

/** Albums / Artists page: source filter, size, sort. */
export interface GroupView {
  filter: Filter
  size: GroupSize
  sort: GroupSort
}

export interface ToastOptions {
  kind?: Toast['kind']
  action?: Toast['action']
  /** Stays until dismissed: a job still running. */
  sticky?: boolean
  /** Says it again in the toast with this id (kept, with its button) instead of adding one; gone by now: nothing. */
  id?: number
}

const MAX_TOASTS = 3
let toastId = 0

interface State {
  view: View
  /** Back / forward stacks for title bar arrows. */
  back: View[]
  fwd: View[]
  status: Record<Service, SourceStatus>
  tracks: LibraryTrack[]
  /** Playlists and orders as Rust sent them; `playlists` and `orders` are what pages show (one Liked Music). */
  raw: Lists
  playlists: LibraryPlaylist[]
  playlistTracks: LibraryTrack[]
  /** Top bar text. Library pages filter by it while scoped (see pageQuery). */
  query: string
  /** Top bar's "In Songs" token: on, a library page filters as you type; off (Backspace), the bar searches everywhere. */
  scoped: boolean
  setScoped: (scoped: boolean) => void
  /** Last "search everywhere" (top bar Enter): the Search page runs it. n changes on each ask, same text too. found = a
   *  song the Music Detector named, shown above the results. */
  /** `pick`: a song not found whose version the user picks among the results (Songs not found › Find this song). */
  search: { q: string; n: number; found?: Track; pick?: VersionPick } | null
  searchFor: (q: string, found?: Track, pick?: VersionPick) => void
  /** Bumped by "Identify a song" (mic menu): the Music Detector on the Add music page starts listening. */
  identify: number
  identifySong: () => void
  filter: Filter
  sort: Sort
  /** Playlist pages: own sort, manual by default. */
  playlistSort: Sort
  albumView: GroupView
  artistView: GroupView
  setGroupView: (page: 'albumView' | 'artistView', patch: Partial<GroupView>) => void
  /** Random sort order; new pick = new seed. */
  seed: number
  stats: PlayStats
  /** Your rating of a song in half stars (0 takes it off): shown at once, saved behind. `say`: a toast tells it. */
  rate: (trackId: number, stars: number, say?: boolean) => Promise<void>
  busy: boolean
  error?: string
  /** Newest last, auto-cleared. */
  toasts: Toast[]
  /** `auto`: run by the 15-minute timer (features/sources/autosync.ts), not by hand. */
  lastSync?: { at: number; report: SyncReport; auto?: boolean }
  /** Playlist id → its track ids in order (covers). */
  orders: Record<number, number[]>
  /** Share code waiting for the import dialog. */
  incoming?: string
  /** Playlist whose share panel is open. */
  sharing: number | null
  go: (view: View) => void
  goBack: () => void
  goForward: () => void
  setQuery: (query: string) => void
  setFilter: (filter: Filter) => void
  setSort: (sort: Sort) => void
  setPlaylistSort: (sort: Sort) => void
  dismissError: () => void
  /** Everything read again: sign-in states, library, play counts. Startup, syncs, imports, sign-ins. */
  refresh: () => Promise<void>
  /** After an edit (like, add, playlist edit, removal, merge…): only the library rows written since come, patched in
   *  (the whole library when too many did). */
  refreshChanged: () => Promise<void>
  /** `auto`: the timer's, quiet (no toast). */
  sync: (o?: { auto?: boolean }) => Promise<void>
  connect: (source: Service, credentials: Credentials) => Promise<boolean>
  disconnect: (source: Service) => Promise<void>
  /** Returns new playlist id for create / duplicate. */
  editPlaylist: (edit: PlaylistEdit) => Promise<number | null>
  addLink: (url: string) => Promise<void>
  /** Public Spotify playlist / album link: import it and open it. */
  importSpotify: (url: string) => Promise<void>
  /** A Deezer or Apple Music playlist / album link: a playlist of yours with the songs found on YouTube. */
  importLink: (url: string, from: 'deezer' | 'apple') => Promise<void>
  /** Spotify's ticked lists, by `job` (Exportify's file or Spotify's page): the import screen (features/add/ImportScreen). */
  /** On the import screen: Spotify's lists by default, else Apple Music's, the songs not found or a shared list. */
  importSpotifyLists: (job: () => Promise<SpotifyLibraryImport>, kind?: ImportKind) => Promise<void>
  importRun?: ImportRun
  /** Songs YouTube had no version of (track ids). */
  notFound: number[]
  hideImport: () => void
  showImport: () => void
  endImport: () => void
  /** Add › Import a list of songs. True when a playlist came out of it. */
  importSongList: (name: string, text: string | null, path: string | null) => Promise<boolean>
  /** Settings › General › Notifications, set by app/settings: errors and toasts with a button only; time × scale. */
  toastPrefs: { important: boolean; scale: number }
  /** Toast for 4 s (with a button 6 s, error 8 s), times toastPrefs.scale. Returns its id (0: not shown). */
  notify: (text: string, opts?: ToastOptions) => number
  dismissToast: (id: number) => void
}

export interface VersionPick {
  id: number
  title: string
  artist: string
}

const offline: SourceStatus = { configured: false, connected: false }

// The toast while the import screen is hidden.
let importToast = 0

const importText = (p: SpotifyProgress | undefined, kind: ImportKind) => {
  if (!p) return tr('Importing…')
  const { list, lists, name, done, total } = p
  // None names a service: the songs not found searched again, a list shared with Legato, an app's library file.
  if (kind === 'again') return tr('Searching YouTube… {done} of {total}', { done: p.searched, total: p.toSearch })
  if (kind === 'shared' || kind === 'file') return tr('Importing “{name}”… {done} of {total}', { name, done, total })
  if (kind === 'apple') {
    if (p.matching && p.toSearch) return tr('Apple Music: searching YouTube… {done} of {total}', { done: p.searched, total: p.toSearch })
    return p.matching ? tr('Apple Music, list {list} of {lists}: finding “{name}” on YouTube… {done} of {total}', { list, lists, name, done, total }) : tr('Apple Music, list {list} of {lists}: reading “{name}”… {done} of {total}', { list, lists, name, done, total })
  }
  if (p.matching && p.toSearch) return tr('Spotify: searching YouTube… {done} of {total}', { done: p.searched, total: p.toSearch })
  return p.matching ? tr('Spotify, list {list} of {lists}: finding “{name}” on YouTube… {done} of {total}', { list, lists, name, done, total }) : tr('Spotify, list {list} of {lists}: reading “{name}”… {done} of {total}', { list, lists, name, done, total })
}

/** What a library page filters by: the top bar's text while its token is on. */
export const pageQuery = (s: State) => (s.scoped ? s.query : '')

export const useStore = create<State>((set, get) => {
  /** Run action: busy flag, error capture, reload (whole, or what changed). Returns success. */
  async function run(fn: () => Promise<unknown>, whole = true): Promise<boolean> {
    set({ busy: true, error: undefined })
    try {
      await fn()
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    } finally {
      await (whole ? get().refresh() : get().refreshChanged())
      set({ busy: false })
    }
  }

  // Latest playlist page asked: a slow answer for the previous one must not land on this one.
  let shown = 0
  function loadPlaylist(id: number) {
    const mine = ++shown
    return playlistSongs(id).then((playlistTracks) => void (mine === shown && get().view.name === 'playlist' && set({ playlistTracks })), () => {})
  }

  // One library read at a time: each empties Rust's change log, so an answer landing after a newer one would undo it.
  let lane: Promise<unknown> = Promise.resolve()
  function inLane(read: () => Promise<void>) {
    const next = lane.then(read)
    lane = next.catch(() => {})
    return next
  }

  async function readWhole() {
    const [status, { tracks, playlists, orders }, stats, notFound] = await Promise.all([api.sourcesStatus(), api.library(), api.playStats().catch(() => ({})), api.notFound().catch(() => [])])
    set({ status, tracks, ...lists({ playlists, orders }), stats, notFound })
    // The open playlist follows (sync, Find versions, add to YouTube, removals).
    const v = get().view
    if (v.name === 'playlist') void loadPlaylist(v.id)
  }

  async function readChanges() {
    const c = await api.libraryChanges()
    if (!c) return readWhole()
    const before = get()
    const { tracks, playlists, orders } = patchLibrary({ tracks: before.tracks, ...before.raw }, c)
    set({ tracks, ...lists({ playlists, orders }), notFound: await api.notFound().catch(() => before.notFound) })
    if (c.history) set({ stats: await api.playStats().catch(() => get().stats) })
    // The open playlist again only when it changed: its own rows, or one of its songs (rows without a source too).
    const v = get().view
    if (v.name !== 'playlist') return
    const touched = new Set([...c.gone, ...c.tracks.map((t) => t.id)])
    if (shownIds(v.id, before.raw.playlists).some((id) => id in c.orders) || c.playlistsGone.includes(v.id) || before.playlistTracks.some((t) => touched.has(t.id))) await loadPlaylist(v.id)
  }

  // Same lists in, same objects out: memoized pages stay as they are.
  let folded: { raw: Lists; shown: Lists } | undefined
  function lists(raw: Lists) {
    if (folded?.raw.playlists !== raw.playlists || folded.raw.orders !== raw.orders) folded = { raw, shown: oneLiked(raw) }
    return { raw, ...folded.shown }
  }

  function show(view: View) {
    // Your Liked Music beside YouTube Music's: shown as that one.
    const raw = get().raw.playlists
    if (view.name === 'playlist' && view.id === ownLiked(raw)?.id) view = { name: 'playlist', id: youtubeLiked(raw)?.id ?? view.id }
    // Another playlist: its rows, not the last one's, while they load.
    if (view.name === 'playlist' && (get().view.name !== 'playlist' || (get().view as { id: number }).id !== view.id)) set({ playlistTracks: [] })
    // Leaving the Search page: its text must not filter the next list. Each page gets its token back.
    if (get().view.name === 'search' && view.name !== 'search') set({ query: '' })
    // Back to it: its text again.
    if (view.name === 'search' && get().view.name !== 'search' && get().search) set({ query: get().search!.q })
    set({ view, scoped: true })
    // A playlist, album, artist or mix opened: Home's Jump back in.
    noteList(view)
    if (view.name === 'playlist') loadPlaylist(view.id)
  }

  return {
    view: { name: 'songs' },
    notFound: [],
    back: [],
    fwd: [],
    status: { spotify: offline, youtube: offline },
    tracks: [],
    raw: { playlists: [], orders: {} },
    playlists: [],
    playlistTracks: [],
    orders: {},
    query: '',
    scoped: true,
    search: null,
    identify: 0,
    filter: 'all',
    sort: 'artist',
    playlistSort: 'manual',
    albumView: { filter: 'all', size: 'all', sort: 'name' },
    artistView: { filter: 'all', size: 'all', sort: 'name' },
    seed: 1,
    stats: {},
    busy: false,
    sharing: null,
    toasts: [],
    toastPrefs: { important: false, scale: 1 },

    go: (view) => {
      set({ back: [...get().back, get().view].slice(-50), fwd: [] })
      show(view)
    },
    goBack: () => {
      const { back, fwd, view } = get()
      if (!back.length) return
      set({ back: back.slice(0, -1), fwd: [view, ...fwd] })
      show(back[back.length - 1])
    },
    goForward: () => {
      const { back, fwd, view } = get()
      if (!fwd.length) return
      set({ back: [...back, view], fwd: fwd.slice(1) })
      show(fwd[0])
    },
    setQuery: (query) => set({ query }),
    setScoped: (scoped) => set({ scoped }),
    searchFor: (q, found, pick) => {
      set({ search: { q, n: (get().search?.n ?? 0) + 1, found, pick }, query: q })
      if (get().view.name !== 'search') get().go({ name: 'search' })
    },
    identifySong: () => {
      set({ identify: get().identify + 1 })
      if (get().view.name !== 'add') get().go({ name: 'add' })
    },
    setFilter: (filter) => set({ filter }),
    setSort: (sort) => set({ sort, ...(sort === 'random' && { seed: Date.now() }) }),
    setGroupView: (page, patch) => set({ [page]: { ...get()[page], ...patch }, ...(patch.sort === 'random' && { seed: Date.now() }) }),
    setPlaylistSort: (playlistSort) => set({ playlistSort, ...(playlistSort === 'random' && { seed: Date.now() }) }),
    dismissError: () => set({ error: undefined }),

    refresh: () => inLane(readWhole),
    refreshChanged: () => inLane(readChanges),

    async sync({ auto = false } = {}) {
      let report: SyncReport | undefined
      await run(async () => {
        report = await api.sync()
        set({ lastSync: { at: Date.now(), report, auto } })
      })
      if (report && !report.errors.length && !auto) get().notify(tr('Playlists imported: {n}', { n: report.playlists }))
    },
    connect: (source, credentials) => run(() => api.connect(source, credentials)),
    disconnect: (source) => run(() => api.disconnect(source)).then(() => {}),
    async addLink(url) {
      let added = ''
      // A SoundCloud song is found on YouTube first: a few seconds.
      if (soundcloudLink(url)) get().notify(tr('Finding this song on YouTube…'))
      if (await run(async () => (added = await api.addLink(url)), false)) get().notify(tr('Added: {title}', { title: added }))
    },
    async importSongList(name, text, path) {
      get().notify(tr('Importing your list… (finding each song on YouTube)'))
      let r: Awaited<ReturnType<typeof api.importSongList>> | undefined
      if (!(await run(async () => (r = await api.importSongList(name, text, path)))) || !r) return false
      if (r.playlistId === null) {
        get().notify(trn(r.songs, 'None of the {n} song was found on YouTube', 'None of the {n} songs were found on YouTube'), { kind: 'error' })
        return false
      }
      get().notify(tr('Imported “{name}”: {found} of {songs} songs', { name: r.name, found: r.found, songs: r.songs }))
      if (r.missing.length) get().notify(tr('Not found: {songs}', { songs: r.missing.slice(0, 3).join(', ') + (r.songs - r.found > 3 ? '…' : '') }), { kind: 'info' })
      get().go({ name: 'playlist', id: r.playlistId })
      return true
    },
    async importSpotify(url) {
      get().notify(tr('Importing from Spotify… (finding each song on YouTube)'))
      let r: Awaited<ReturnType<typeof api.importSpotifyLink>> | undefined
      if (!(await run(async () => (r = await api.importSpotifyLink(url)))) || !r) return
      const missing = r.tracks - r.playable
      const done = trn(r.tracks, 'Imported “{name}”: {n} song', 'Imported “{name}”: {n} songs', { name: r.name })
      const lost = missing ? ` · ${trn(missing, '{n} without a YouTube version', '{n} without a YouTube version')}` : ''
      get().notify(done + lost)
      // Spotify's embed shows 100 songs at most; its API (your own key) reads the rest.
      if (r.truncated) get().notify(tr('Only the first 100 songs came in: connect Spotify in Accounts to import the whole playlist.'), { kind: 'info', action: { label: tr('Connect'), run: () => get().go({ name: 'settings', section: 'sources', wizard: 'spotify' }) } })
      get().go({ name: 'playlist', id: r.playlistId })
    },
    async importLink(url, from) {
      const service = from === 'deezer' ? 'Deezer' : 'Apple Music'
      // Up to 3000 searches: a toast that counts them, with a way out.
      const cancel = { label: tr('Cancel'), run: () => void api.importLinkStop() }
      const shown = get().notify(tr('Importing from {service}… (finding each song on YouTube)', { service }), { sticky: true, action: cancel })
      const off = api.onImportProgress((done, total) => get().notify(tr('Importing from {service}… {done} of {total}', { service, done, total }), { sticky: true, id: shown }))
      let r: Awaited<ReturnType<typeof api.importLink>> | undefined
      let canceled = false
      const ok = await run(async () => {
        try {
          r = await api.importLink(url)
        } catch (e) {
          if (String(e) !== 'canceled') throw e
          canceled = true
        }
      })
      void off.then((f) => f())
      get().dismissToast(shown)
      if (canceled) return void get().notify(tr('Import canceled'), { kind: 'info' })
      if (!ok || !r) return
      if (r.playlistId === null) {
        get().notify(trn(r.songs, 'None of the {n} song was found on YouTube', 'None of the {n} songs were found on YouTube'), { kind: 'error' })
        return
      }
      get().notify(trn(r.songs, 'Imported “{name}”: {found} of {n} song found', 'Imported “{name}”: {found} of {n} songs found', { name: r.name, found: r.found }))
      if (r.missing.length) get().notify(tr('Not found: {songs}', { songs: r.missing.slice(0, 3).join(', ') + (r.songs - r.found > 3 ? '…' : '') }), { kind: 'info' })
      // The link showed (or Apple's page listed) fewer songs than the list has.
      if (r.total > r.songs) get().notify(tr('Only {n} of the {total} songs came in: the link shows no more.', { n: r.songs, total: r.total }), { kind: 'info' })
      get().go({ name: 'playlist', id: r.playlistId })
    },
    async importSpotifyLists(job, kind) {
      set({ importRun: newRun(kind) })
      let latest: SpotifyProgress | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const beat = () => {
        timer = undefined
        const run = get().importRun
        if (!run || !latest) return
        set({ importRun: advance(run, latest) })
        if (run.hidden) get().notify(importText(latest, run.kind), { sticky: true, id: importToast })
      }
      let listsShown = false
      const offDoubt = api.onImportDoubt((d) => {
        const run = get().importRun
        if (run) set({ importRun: { ...run, doubts: [...run.doubts, d] } })
      })
      const off = api.onSpotifyImport((p) => {
        latest = p
        timer ??= setTimeout(beat, BEAT)
        // Every list saved: the library has them while the searches go on.
        if (!listsShown && p.matching && p.toSearch) {
          listsShown = true
          get().refresh().catch(() => undefined)
        }
      })
      let r: SpotifyLibraryImport | undefined
      let canceled = false
      // A failed refresh after it says nothing about the import: its end still shows.
      const ok = await run(async () => {
        try {
          r = await job()
        } catch (e) {
          if (String(e) !== 'canceled') throw e
          canceled = true
        }
      }).catch(() => !!r)
      void off.then((f) => f())
      void offDoubt.then((f) => f())
      clearTimeout(timer)
      const seen = get().importRun
      get().dismissToast(importToast)
      if (canceled) {
        set({ importRun: undefined })
        return void get().notify(tr('Import canceled'), { kind: 'info' })
      }
      if (!ok || !r) return set({ importRun: undefined })
      if (seen && !seen.hidden) return set({ importRun: { ...seen, result: r } })
      // Hidden: the app is in use, the news is a toast.
      set({ importRun: undefined })
      const id = r.playlistId
      get().notify(summary(r), id === null ? {} : { action: { label: tr('Open'), run: () => get().go({ name: 'playlist', id }) } })
      if (r.failed.length) get().notify(tr('Not read: {lists}', { lists: r.failed.slice(0, 3).join(', ') + (r.failed.length > 3 ? '…' : '') }), { kind: 'error' })
    },
    hideImport() {
      const run = get().importRun
      if (!run || run.hidden) return
      set({ importRun: { ...run, hidden: true } })
      importToast = get().notify(importText(run.progress, run.kind), { sticky: true, action: { label: tr('Show'), run: () => get().showImport() } })
    },
    showImport() {
      const run = get().importRun
      if (run) set({ importRun: { ...run, hidden: false } })
      get().dismissToast(importToast)
    },
    endImport: () => set({ importRun: undefined }),
    notify(said, { kind = 'ok', action, sticky, id: again } = {}) {
      const { important, scale } = get().toastPrefs
      if (important && kind !== 'error' && !action && again === undefined) return 0
      // Errors often come raw from Rust (notify(String(e))): said in plain words when it's a network failure.
      const text = kind === 'error' ? explain(said).text : said
      if (again !== undefined) {
        set({ toasts: get().toasts.map((t) => (t.id === again ? { ...t, text } : t)) })
        return again
      }
      const id = ++toastId
      // Same text again: replace, don't stack.
      const rest = get().toasts.filter((t) => t.text !== text)
      set({ toasts: [...rest, { id, text, kind, action }].slice(-MAX_TOASTS) })
      if (!sticky) setTimeout(() => get().dismissToast(id), (kind === 'error' ? 8000 : action ? 6000 : 4000) * scale)
      return id
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    async rate(trackId, stars, say) {
      const before = get().stats[trackId]
      const put = (v: PlayStats[number] | undefined) => {
        const next = { ...get().stats }
        if (v) next[trackId] = v
        else delete next[trackId]
        set({ stats: next })
      }
      put([before?.[0] ?? 0, before?.[1] ?? 0, stars])
      try {
        await api.setRating(trackId, stars)
        if (say) get().notify(stars ? tr('Rated: {stars}', { stars: starsText(stars) }) : tr('Rating removed'))
      } catch (e) {
        put(before)
        get().notify(String(e), { kind: 'error' })
      }
    },
    async editPlaylist(edit) {
      let id: number | null = null
      // The open playlist comes again with the changes when it is the one edited.
      await run(async () => (id = await api.editPlaylist(edit)), false)
      return id
    },
  }
})

/** A playlist's songs as its page shows them: the account's Liked Music with yours folded in. */
export async function playlistSongs(id: number): Promise<LibraryTrack[]> {
  const ids = shownIds(id, useStore.getState().raw.playlists)
  if (ids.length === 1) return api.playlistTracks(id)
  const [own, account] = await Promise.all(ids.map((i) => api.playlistTracks(i)))
  return fold(own, account, (t) => t.id)
}

import { useStore } from '../../app/store'
import { api, type LibraryTrack, type RoomEvent, type RoomFind, type RoomNow, type RoomReaction, type RoomSong, type RoomStatus } from '../../shared/api'
import { note, reportError } from '../../shared/diag'
import { tr } from '../../shared/i18n/i18n'
import { holdControls, nowTrack, passOver, remoteTrack, roomMove, usePlayer, type NowPlaying } from '../player/store'
import { queueRows } from '../player/queue'
import { useRoom } from './room'
import { catchUp as caughtUp, follow, positionAt, SETTLE_MS, songKey, START, type Follow, type Mine, type Step } from './roomFollow'

// Listening rooms (docs/rooms.md): the host's player sent as it changes, a listener's player kept on the room's song
// (roomFollow.ts decides, this file applies), reactions floating a moment. Rust: src-tauri/src/rooms.rs.

/** A reaction floats this long (ms). */
const FLOAT_MS = 2600
/** A listener's player looked at this often (ms). */
const EVERY = 1000
/** The host's position jumped by more than this against the clock: a seek, sent at once (ms). */
const JUMP_MS = 2500

let follower: Follow = START
let room: RoomNow | null = null
/** The player's song for the room's current one, and whether it's still being looked for. */
let given: number | null = null
let loading = false
/** Each room song's answer here, by key (a song looked for once). */
const found = new Map<string, RoomFind>()
let floatId = 0

const notify = (text: string, kind: 'ok' | 'info' | 'error' = 'info') => useStore.getState().notify(text, { kind })

function status(s: RoomStatus) {
  const was = useRoom.getState().status?.role ?? 'off'
  useRoom.setState({ status: s })
  if (s.role !== was) roleChanged(s)
}

/** Interface words for the errors Rust says (English there). */
export function roomError(e: unknown): string {
  const text = String(e)
  const known: Record<string, string> = {
    'Wrong code': tr('Wrong code'),
    'This room is full': tr('This room is full'),
    'The code has 6 digits': tr('The code has 6 digits'),
    'No room on this network': tr('No room on this network'),
    'Not a Legato room code': tr('Not a Legato room code'),
    'Already in a room': tr('Already in a room'),
    'This room runs another version of Legato': tr('This room runs another version of Legato'),
    // Joins shut a while after too many wrong codes (Rust's `rooms::shut_ms`).
    'Too many wrong codes': tr('Too many requests for now: wait a few minutes, then try again.'),
  }
  return known[text] ?? text
}

export async function refreshRoom(): Promise<void> {
  try {
    status(await api.roomStatus())
  } catch (e) {
    reportError('rooms', e, 'Room status failed')
  }
}

export async function startRoom(): Promise<void> {
  try {
    status(await api.roomStart())
  } catch (e) {
    notify(roomError(e), 'error')
  }
}

export async function endRoom(): Promise<void> {
  await api.roomEnd().catch(() => {})
  await refreshRoom()
}

/** Joins a room heard (`id`) or scanned (`link`). Throws the interface's words. */
export async function joinRoom(id: string | null, link: string | null, code: string): Promise<void> {
  try {
    status(await api.roomJoin(id, link, code))
  } catch (e) {
    throw new Error(roomError(e))
  }
}

export async function leaveRoom(): Promise<void> {
  await api.roomLeave().catch(() => {})
  await refreshRoom()
}

export function react(reaction: RoomReaction): void {
  float(tr('You'), reaction)
  void api.roomReact(reaction).catch(() => {})
}

/** After their own pause: back where the room is. */
export function catchUp(): void {
  follower = caughtUp(follower)
  useRoom.setState({ own: false })
  run()
}

function float(from: string, reaction: RoomReaction) {
  const id = ++floatId
  useRoom.setState((s) => ({ floats: [...s.floats.slice(-5), { id, from, reaction }] }))
  setTimeout(() => useRoom.setState((s) => ({ floats: s.floats.filter((f) => f.id !== id) })), FLOAT_MS)
}

// ——— the host ———

/** A song as it goes into the room: ids and a web cover, never a path (Rust checks again). */
export function roomSong(t: Pick<LibraryTrack, 'title' | 'artist' | 'album' | 'durationMs' | 'isrc' | 'ids' | 'art'> | undefined, now?: NowPlaying): RoomSong | null {
  const title = now?.title ?? t?.title
  if (!title) return null
  const art = t?.art?.startsWith('https://') ? t.art : null
  return { title, artist: now?.artist ?? t?.artist ?? '', album: t?.album ?? null, durationMs: t?.durationMs ?? null, isrc: t?.isrc ?? null, youtube: now?.youtubeId ?? t?.ids.youtube ?? null, spotify: now?.spotifyId ?? t?.ids.spotify ?? null, art }
}

/** Up next's first songs, in play order. */
export function nextSongs(list: LibraryTrack[], order: number[], index: number, max = 3): RoomSong[] {
  const rows = queueRows(order, index, (i) => !!list[i])
  const at = rows.findIndex((r) => r.current)
  return rows
    .slice(at + 1)
    .map((r) => roomSong(list[r.i]))
    .filter((s): s is RoomSong => !!s)
    .slice(0, max)
}

let offHost: (() => void) | null = null
let seq = 0

function hostFeed(): () => void {
  let last = { pos: 0, at: Date.now() }
  const sendNow = (bump: boolean) => {
    const p = usePlayer.getState()
    if (bump) seq++
    last = { pos: p.positionMs, at: Date.now() }
    const song = p.now ? roomSong(nowTrack(), p.now) : null
    void api.roomHostNow({ song, positionMs: Math.max(0, Math.round(p.positionMs)), playing: p.playing && !!song, at: Date.now(), seq }).catch(() => {})
  }
  const sendNext = () => {
    const { list, order, index } = usePlayer.getState()
    void api.roomHostNext(nextSongs(list, order, index)).catch(() => {})
  }
  const off = usePlayer.subscribe((s, p) => {
    if (s.playId !== p.playId || s.now?.youtubeId !== p.now?.youtubeId || s.now?.title !== p.now?.title) return sendNow(true)
    if (s.playing !== p.playing) return sendNow(false)
    if (s.positionMs !== p.positionMs) {
      const expected = last.pos + (s.playing ? Date.now() - last.at : 0)
      if (Math.abs(s.positionMs - expected) > JUMP_MS) sendNow(true)
      else if (s.playing) last = { pos: s.positionMs, at: Date.now() }
    }
    if (s.list !== p.list || s.order !== p.order || s.index !== p.index) sendNext()
  })
  sendNow(true)
  sendNext()
  return off
}

// ——— a listener ———

function mine(): Mine {
  const p = usePlayer.getState()
  return { key: !loading && given !== null && p.now?.trackId === given ? follower.song : null, positionMs: p.positionMs, playing: p.playing }
}

function run() {
  if (!room || useRoom.getState().status?.role !== 'listener') return
  const [next, step] = follow(follower, room, mine(), Date.now())
  follower = next
  if (useRoom.getState().own !== next.own) useRoom.setState({ own: next.own })
  if (step) void apply(step)
}

async function find(song: RoomSong, now: boolean): Promise<RoomFind> {
  const key = songKey(song)!
  const known = found.get(key)
  if (known && known.kind !== 'later') return known
  const f = await api.roomResolve(song, now).catch((): RoomFind => ({ kind: 'missing' }))
  if (f.kind !== 'later') found.set(key, f)
  return f
}

const trackOf = (f: RoomFind): LibraryTrack | undefined => (f.kind === 'library' ? useStore.getState().tracks.find((t) => t.id === f.id) : f.kind === 'track' ? remoteTrack(f.track) : undefined)

async function apply(step: Step) {
  const p = usePlayer.getState()
  if (step.kind === 'seek') return roomMove(() => p.seek(step.ms))
  if (step.kind === 'play') return void (!p.playing && roomMove(() => p.toggle()))
  if (step.kind === 'pause') return void (p.playing && roomMove(() => p.toggle()))
  const key = songKey(step.song)
  loading = true
  useRoom.setState({ finding: true, missing: null })
  const t = trackOf(await find(step.song, true))
  loading = false
  useRoom.setState({ finding: false })
  // The room moved on meanwhile: the next look does the next song.
  if (follower.song !== key || !room) return
  if (!t || passOver(t, 0)) {
    note('rooms', 'a room song is not found here')
    follower = { ...follower, missing: true }
    given = null
    useRoom.setState({ missing: step.song.title })
    roomMove(() => usePlayer.getState().pauseNow())
    return
  }
  given = t.id
  follower = { ...follower, quietUntil: Date.now() + SETTLE_MS }
  roomMove(() => usePlayer.getState().resume({ list: [t], index: 0, order: [0], shuffle: false, repeat: 'off', positionMs: positionAt(room!, Date.now()), paused: !step.play }))
}

/** The songs coming, looked for ahead (no search unless the pace allows it now). */
async function ahead(songs: RoomSong[]) {
  for (const s of songs) await find(s, false)
}

function heldHere() {
  useStore.getState().notify(tr('You follow the room: the host picks the songs'), { kind: 'info', action: { label: tr('Leave'), run: () => void leaveRoom() } })
}

function listenerStart(s: RoomStatus) {
  follower = START
  given = null
  room = s.now
  found.clear()
  useRoom.setState({ missing: null, own: false })
  holdControls(heldHere)
  void ahead(s.next)
  run()
}

function listenerStop() {
  holdControls(null)
  room = null
  follower = START
  given = null
  useRoom.setState({ missing: null, own: false, finding: false })
}

function roleChanged(s: RoomStatus) {
  offHost?.()
  offHost = null
  listenerStop()
  if (s.role === 'host') offHost = hostFeed()
  if (s.role === 'listener') listenerStart(s)
}

function onEvent(e: RoomEvent) {
  switch (e.kind) {
    case 'state':
      return void refreshRoom()
    case 'now':
      room = e.now
      return run()
    case 'next':
      return void ahead(e.songs)
    case 'react':
      return float(e.from, e.reaction)
    case 'end':
      notify(e.gone ? tr('The room’s host left') : tr('The room ended'))
      return void refreshRoom()
  }
}

/** Runs rooms from the first screen on (deferred.ts). Returns cleanup. */
export function startRooms(): () => void {
  let off: (() => void) | undefined
  let dead = false
  void api.onRoom(onEvent).then((f) => (dead ? f() : (off = f)))
  void refreshRoom()
  const timer = setInterval(run, EVERY)
  return () => {
    dead = true
    off?.()
    clearInterval(timer)
    offHost?.()
    listenerStop()
  }
}

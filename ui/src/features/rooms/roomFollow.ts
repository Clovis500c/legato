import type { RoomNow, RoomSong } from '../../shared/api'

// A listener follows the room: pure rules, no player here (rooms.ts applies them). The drift rule's twin is
// `music_core::rooms::should_seek` (keep them alike).

/** Off by more than this: seek (ms). `music_core::rooms::DRIFT_MS`. */
export const DRIFT_MS = 1500
/** After a load or a seek: left alone this long (ms), no seek loops while a player catches up. `SETTLE_MS`. */
export const SETTLE_MS = 4000

/** One key per song: its YouTube id, else Spotify's, ISRC, title and artist. */
export function songKey(s: RoomSong | null | undefined): string | null {
  if (!s) return null
  if (s.youtube) return `yt:${s.youtube}`
  if (s.spotify) return `sp:${s.spotify}`
  if (s.isrc) return `isrc:${s.isrc}`
  return `t:${s.title.toLowerCase()}\u0000${s.artist.toLowerCase()}`
}

/** Where the room's song is at `t` (this clock): moving while it plays, never past its end. Twin of `Now::position_at`. */
export function positionAt(n: RoomNow, t: number): number {
  const p = n.positionMs + (n.playing ? Math.max(0, t - n.at) : 0)
  return Math.max(0, Math.min(p, n.song?.durationMs ?? Number.MAX_SAFE_INTEGER))
}

export const shouldSeek = (expectedMs: number, actualMs: number, now: number, quietUntil: number) => now >= quietUntil && Math.abs(expectedMs - actualMs) > DRIFT_MS

export interface Follow {
  /** The room's song given to this player (its key), and the room's seq then. */
  song: string | null
  seq: number
  /** No drift seek before then. */
  quietUntil: number
  /** Paused on their own: the room goes on without them until Catch up. */
  own: boolean
  /** The room's song isn't found here: nothing to follow until the next one. */
  missing: boolean
  /** Play (true) or pause (false) last asked here: a pause nobody asked for is the listener's own. */
  asked: boolean | null
}

export const START: Follow = { song: null, seq: -1, quietUntil: 0, own: false, missing: false, asked: null }

/** This device's player. `key`: the room song it plays (null: something else, or still loading). `ended`: its song
 *  played to its end here (another version, or a little ahead of the room). */
export interface Mine {
  key: string | null
  positionMs: number
  playing: boolean
  ended?: boolean
}

export type Step = { kind: 'load'; song: RoomSong; atMs: number; play: boolean } | { kind: 'seek'; ms: number } | { kind: 'play' } | { kind: 'pause' }

/** The next thing to do, at `now` (this clock): a new song at once, play / pause at once, a seek when the host seeked
 *  or the drift is past `DRIFT_MS` (then quiet for `SETTLE_MS`). */
export function follow(f: Follow, room: RoomNow, mine: Mine, now: number): [Follow, Step | null] {
  const key = songKey(room.song)
  const at = positionAt(room, now)
  if (!room.song) return [{ ...f, song: null, seq: room.seq }, mine.playing && !f.own ? { kind: 'pause' } : null]
  if (key !== f.song) {
    const play = room.playing && !f.own
    return [{ ...f, song: key, seq: room.seq, quietUntil: now + SETTLE_MS, missing: false, asked: play }, { kind: 'load', song: room.song, atMs: at, play }]
  }
  if (f.missing || f.own) return [{ ...f, seq: room.seq }, null]
  // Still loading, or another song playing for now (the load's own answer comes).
  if (mine.key !== key) return [f, null]
  if (room.playing && !mine.playing) {
    // Its song over here first: the host's next one comes. Not the listener's own pause.
    if (mine.ended) return [f, null]
    // A pause nobody asked for, once the player had its moment to start: the listener's own.
    if (f.asked === true && now >= f.quietUntil) return [{ ...f, own: true }, null]
    // Seq kept: a seek still due (Catch up, the host's seek meanwhile) comes once it plays.
    if (f.asked !== true) return [{ ...f, asked: true, quietUntil: now + SETTLE_MS }, { kind: 'play' }]
    return [f, null]
  }
  if (!room.playing && mine.playing) return [{ ...f, asked: false }, { kind: 'pause' }]
  if (room.seq !== f.seq) return [{ ...f, seq: room.seq, quietUntil: now + SETTLE_MS }, { kind: 'seek', ms: at }]
  // The room's place stops at its song's end (its length as the host knows it): no seek back there.
  const end = room.song.durationMs
  if (end != null && at >= end - DRIFT_MS) return [f, null]
  if (room.playing && shouldSeek(at, mine.positionMs, now, f.quietUntil)) return [{ ...f, quietUntil: now + SETTLE_MS }, { kind: 'seek', ms: at }]
  return [f, null]
}

/** Catch up after their own pause: play, then where the room is. */
export const catchUp = (f: Follow): Follow => ({ ...f, own: false, asked: null, quietUntil: 0, seq: -1 })

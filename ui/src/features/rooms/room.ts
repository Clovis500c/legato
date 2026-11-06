import { create } from 'zustand'
import type { RoomReaction, RoomStatus } from '../../shared/api'

/** A reaction floating a moment over the cover. */
export interface Float {
  id: number
  from: string
  reaction: RoomReaction
}

/** Listening room (rooms.ts runs it, RoomDialog.tsx shows it): light, for the shell's menus and the player's pill. */
export const useRoom = create<{
  status: RoomStatus | null
  /** The room's view open. */
  open: boolean
  floats: Float[]
  /** A listener's: the room's song isn't found here (its title), the room goes on. */
  missing: string | null
  /** A listener's: paused on their own, Catch up to follow again. */
  own: boolean
  /** A listener's: the room's song is being looked for. */
  finding: boolean
}>(() => ({ status: null, open: false, floats: [], missing: null, own: false, finding: false }))

export const openRoom = () => useRoom.setState({ open: true })
export const closeRoom = () => useRoom.setState({ open: false })

/** In a room, as host or listener. */
export const inRoom = (s: RoomStatus | null) => s?.role === 'host' || s?.role === 'listener'

/** The fixed set, in its order, with what each one shows. */
export const REACTIONS: Array<[RoomReaction, string]> = [
  ['heart', '❤️'],
  ['fire', '🔥'],
  ['laugh', '😂'],
  ['clap', '👏'],
  ['party', '🎉'],
  ['wow', '😮'],
]

export const emoji = (r: RoomReaction) => REACTIONS.find(([k]) => k === r)?.[1] ?? '❤️'

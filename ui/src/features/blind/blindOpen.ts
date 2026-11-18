import { create } from 'zustand'
import type { LibraryTrack } from '../../shared/api'

/** The blind test covers the whole window while it is open (Settings › Playback › Blind test, off by default; app menu › Blind test…). */
/** `pool`: the songs a game is made from (a playlist's); none = the whole library. */
export const useBlind = create<{ open: boolean; pool?: LibraryTrack[] }>(() => ({ open: false }))
export const openBlind = (pool?: LibraryTrack[]) => useBlind.setState({ open: true, pool })
export const closeBlind = () => useBlind.setState({ open: false, pool: undefined })

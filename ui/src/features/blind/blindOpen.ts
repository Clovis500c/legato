import { create } from 'zustand'

/** The blind test covers the whole window while it is open (Settings › Playback › Blind test, off by default; app menu › Blind test…). */
export const useBlind = create<{ open: boolean }>(() => ({ open: false }))
export const openBlind = () => useBlind.setState({ open: true })
export const closeBlind = () => useBlind.setState({ open: false })

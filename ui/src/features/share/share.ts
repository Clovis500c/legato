import { create } from 'zustand'

/** The share card's dialog (ShareDialog.tsx, loaded when first opened), for the song playing. */
export const useShare = create<{ open: boolean }>(() => ({ open: false }))

export const openShare = () => useShare.setState({ open: true })
export const closeShare = () => useShare.setState({ open: false })

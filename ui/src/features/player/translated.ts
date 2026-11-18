import { create } from 'zustand'

/** The last translation the user asked for (TranslateLyrics), in memory only: the song it is for, its language, what was sent and what came back. */
export const useTranslated = create<{ song: string; code: string; from: string[]; to: string[] } | null>(() => null)

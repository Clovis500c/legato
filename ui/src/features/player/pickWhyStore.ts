import { create } from 'zustand'
import type { PickWhy } from './pickWhy'

/** Why each song the app picked came up, by song id (Up next shows it); memory only. */
export const usePickWhy = create<Record<number, PickWhy>>(() => ({}))

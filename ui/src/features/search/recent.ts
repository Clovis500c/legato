import { create } from 'zustand'
import { fold } from '../../shared/format'

/** Recent searches of the top bar: this PC only (localStorage; settings travel with Sync Mode, these don't). */
const KEY = 'recentSearches'
export const MAX_RECENT = 8

/** q on top, once (case and accents ignored), the oldest dropped past the max. */
export function remember(list: string[], q: string): string[] {
  const text = q.trim()
  if (!text) return list
  return [text, ...list.filter((x) => fold(x) !== fold(text))].slice(0, MAX_RECENT)
}

function load(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

export const useRecent = create<{ list: string[] }>(() => ({ list: load() }))

function save(list: string[]) {
  useRecent.setState({ list })
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the list lives until the app closes.
  }
}

export const addRecent = (q: string) => save(remember(useRecent.getState().list, q))
export const forgetRecent = (q: string) => save(useRecent.getState().list.filter((x) => x !== q))
export const clearRecent = () => save([])

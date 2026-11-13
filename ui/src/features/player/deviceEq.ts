import { create } from 'zustand'

const KEY = 'legato.eqByDevice'
/** Devices remembered at most. */
const KEEP = 50

/** The equalizer preset (its English name) picked for each output device (its name; the system's default is `default`), this PC's. */
function load(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length < 40).slice(-KEEP))
  } catch {
    return {}
  }
}

export const useDeviceEq = create<{ map: Record<string, string> }>(() => ({ map: load() }))

/** Picks `preset` for a device (null: none). */
export function setDeviceEq(device: string | null, preset: string | null) {
  const key = device ?? 'default'
  const rest = Object.fromEntries(Object.entries(useDeviceEq.getState().map).filter(([k]) => k !== key))
  const map = preset && preset !== 'Flat' ? { ...rest, [key]: preset } : rest
  useDeviceEq.setState({ map: Object.fromEntries(Object.entries(map).slice(-KEEP)) })
  try {
    localStorage.setItem(KEY, JSON.stringify(useDeviceEq.getState().map))
  } catch {
    // Full or private: kept for this run only.
  }
}

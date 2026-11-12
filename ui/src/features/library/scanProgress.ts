import { create } from 'zustand'
import { api } from '../../shared/api'

/** Files read so far by a scan of the local folders, [done, total]; null when none is under way. */
export const useScan = create<{ progress: [number, number] | null }>(() => ({ progress: null }))

/** A report as the state to show: the last one (done = total) clears it. */
export const progressOf = ([done, total]: [number, number]): [number, number] | null => (done >= total ? null : [done, total])

/** Follows `scan-progress` (src-tauri `rescan`): the last report (done = total) clears it. Returns cleanup. */
export function startScanProgress(): () => void {
  const off = api.onScan((p) => useScan.setState({ progress: progressOf(p) }))
  return () => void off.then((f) => f())
}

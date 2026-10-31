import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { due } from './autosyncDue'

/** Looked at every minute: a sync is due 15 min after the last one, whoever ran it. */
const LOOK = 60_000

/**
 * Settings › Accounts › Update every 15 minutes (off by default, offered at sign-in): YouTube Music's lists come in
 * again by themselves while the app is open. Not while another sync or an import runs; quiet (no toast). Started after
 * the first screen (deferred.ts). Returns cleanup.
 */
export function startAutoSync(): () => void {
  const look = () => {
    const s = useStore.getState()
    if (!useSettings.getState().settings.autoSync || s.busy || s.importRun || !s.status.youtube.connected) return
    if (!due(s.lastSync && { at: s.lastSync.at, refused: s.lastSync.report.refused }, Date.now())) return
    void s.sync({ auto: true })
  }
  look()
  const timer = setInterval(look, LOOK)
  return () => clearInterval(timer)
}

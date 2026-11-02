import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { loadSong, useEditor } from '../editor/editor'
import { mergedText } from './merged'
import { startPickup } from './pickup'

/**
 * Sync Mode in the interface (mounted once): another PC's changes reload what they touched. OneDrive on this PC and
 * the question never asked: asked once, the answer is in Settings › Sync Mode.
 */
export function startSyncMode(): () => void {
  const off = api.onSync((m) => {
    const text = mergedText(m)
    if (text) useStore.getState().notify(text, { kind: 'info' })
    if (m.settings) void useSettings.getState().reload()
    void useStore.getState().refreshChanged()
    if (m.edits) void loadSong(useEditor.getState().song)
  })
  void api
    .syncStatus()
    .then((s) => {
      if (s.folder || s.asked || !s.onedrive.length) return
      void api.syncDismiss()
      useStore.getState().notify(tr('OneDrive is on this PC: sync your library and settings with your other PCs?'), { kind: 'info', action: { label: tr('Set up'), run: () => useStore.getState().go({ name: 'settings', section: 'sync' }) } })
    })
    .catch(() => {})
  const pickup = startPickup()
  return () => {
    pickup()
    void off.then((f) => f())
  }
}

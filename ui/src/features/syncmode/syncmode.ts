import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type Merged } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { loadSong, useEditor } from '../editor/editor'

/** What another PC brought, in a few words; null = nothing new. */
export function mergedText(m: Merged): string | null {
  const parts = [
    m.playlists && trn(m.playlists, '{n} playlist', '{n} playlists'),
    m.songs && trn(m.songs, '{n} song', '{n} songs'),
    m.deleted + m.removed && trn(m.deleted + m.removed, '{n} deletion', '{n} deletions'),
    m.plays && trn(m.plays, '{n} listen', '{n} listens'),
    m.edits && trn(m.edits, '{n} Live Editor change', '{n} Live Editor changes'),
    m.settings && trn(m.settings, '{n} setting', '{n} settings'),
  ].filter(Boolean)
  return parts.length ? tr('From your other PC: {changes}', { changes: parts.join(', ') }) : null
}

/**
 * Sync Mode in the interface (mounted once): another PC's changes reload what they touched. OneDrive on this PC and
 * the question never asked: asked once, the answer is in Settings › Sync Mode.
 */
export function startSyncMode(): () => void {
  const off = api.onSync((m) => {
    const text = mergedText(m)
    if (text) useStore.getState().notify(text, { kind: 'info' })
    if (m.settings) void useSettings.getState().reload()
    void useStore.getState().refresh()
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
  return () => void off.then((f) => f())
}

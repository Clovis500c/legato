import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../app/store'
import { api, type SharePreview } from '../../shared/api'
import { region } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Stat } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { tr, trn } from '../../shared/i18n/i18n'

/** Shared code (pasted, QR image, nearby) → preview → new custom playlist. */
export function ImportDialog({ code }: { code: string }) {
  const { refresh, go, notify } = useStore(useShallow(({ refresh, go, notify }) => ({ refresh, go, notify })))
  const [preview, setPreview] = useState<SharePreview>()
  const [busy, setBusy] = useState(false)
  const close = useCallback(() => useStore.setState({ incoming: undefined }), [])
  useEffect(() => {
    api
      .sharePreview(code)
      .then(setPreview)
      .catch((e) => {
        useStore.setState({ error: String(e) })
        close()
      })
  }, [code, close])

  const run = async () => {
    setBusy(true)
    try {
      const r = await api.shareImport(code, region())
      await refresh()
      close()
      go({ name: 'playlist', id: r.playlistId })
      notify(trn(r.added, 'Imported {n} track', 'Imported {n} tracks') + (r.missing ? ` · ${trn(r.missing, '{n} not found', '{n} not found')}` : ''))
    } catch (e) {
      useStore.setState({ error: String(e) })
      setBusy(false)
    }
  }

  return (
    <Dialog title={preview?.name || tr('Shared playlist')} kicker={tr('Import a shared playlist')} onClose={close}>
      {preview && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat label={tr('Tracks')} value={preview.tracks} />
            <Stat label={tr('In your library')} value={preview.known} />
            <Stat label={tr('To look up')} value={preview.tracks - preview.known} />
          </div>
          <p className="text-xs text-ink-2">{tr('Missing tracks are looked up on YouTube and Apple Music. You get a custom playlist you can edit.')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {tr('Cancel')}
            </Button>
            <Button disabled={busy} onClick={run}>
              {busy ? tr('Importing…') : tr('Import')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

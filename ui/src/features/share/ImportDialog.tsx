import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type SharePreview } from '../../shared/api'
import { formatCount, region } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line-soft bg-recess px-3 py-2.5">
      <span className="font-mono text-2xl tabular-nums">{formatCount(value)}</span>
      <span className="kicker">{label}</span>
    </div>
  )
}

/** Shared code (pasted, QR image, nearby) → preview → new custom playlist. */
export function ImportDialog({ code }: { code: string }) {
  const { refresh, go, notify } = useStore()
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
      notify(r.missing ? `Imported ${r.added} tracks · ${r.missing} not found` : `Imported ${r.added} tracks`)
    } catch (e) {
      useStore.setState({ error: String(e) })
      setBusy(false)
    }
  }

  return (
    <Dialog title={preview?.name || 'Shared playlist'} kicker="Import a shared playlist" onClose={close}>
      {preview && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat label="Tracks" value={preview.tracks} />
            <Stat label="In your library" value={preview.known} />
            <Stat label="To look up" value={preview.tracks - preview.known} />
          </div>
          <p className="text-xs text-ink-2">Missing tracks are looked up on YouTube and Apple Music. You get a custom playlist you can edit.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={run}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

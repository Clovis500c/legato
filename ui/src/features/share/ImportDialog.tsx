import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../app/store'
import { api, type SharePreview } from '../../shared/api'
import { region } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Stat } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { tr } from '../../shared/i18n/i18n'

/** Shared code (pasted, QR image, nearby) → preview → the import screen → new custom playlist. */
export function ImportDialog({ code }: { code: string }) {
  const { importSpotifyLists, running } = useStore(useShallow(({ importSpotifyLists, importRun }) => ({ importSpotifyLists, running: !!importRun })))
  const [preview, setPreview] = useState<SharePreview>()
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

  // The import screen takes it from here: covers landing, Cancel, the playlist to open at the end.
  const run = () => {
    close()
    void importSpotifyLists(() => api.shareImport(code, region()), 'shared')
  }

  return (
    <Dialog title={preview?.name || tr('Shared playlist')} kicker={tr('Import a shared playlist')} onClose={close}>
      {preview && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat label={tr('Tracks')} value={preview.tracks} />
            <Stat label={tr('In your library')} value={preview.known} />
            <Stat label={tr('To look up')} value={preview.tracks - preview.known - preview.ready} />
          </div>
          <p className="text-xs text-ink-2">{tr('Missing tracks are looked up on YouTube and Apple Music. You get a custom playlist you can edit.')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {tr('Cancel')}
            </Button>
            {/* One import at a time: another one is on its screen or in its toast. */}
            <Button disabled={running} onClick={run}>
              {running ? tr('Importing…') : tr('Import')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

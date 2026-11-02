import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { qrPath } from '../share/qr'
import { remoteLink, useOverlay, useRemote } from './remote'

/** Under Settings › Playback › Phone remote while it's on: the QR code to scan, the link, a new link. */
export function RemotePanel() {
  const { link, failed } = useRemote()
  const note = (text: string) => <p className="border-t border-line px-4 py-3 text-xs text-ink-2">{text}</p>
  if (failed) return note(tr('The phone remote could not start: another app may be using its port. Turn it off and on again.'))
  if (!link) return null
  if (!link.url) return note(tr('This PC is not on a network. Connect it to the Wi-Fi or a cable, then turn the remote off and on.'))
  const url = link.url
  const copy = () => void navigator.clipboard.writeText(url).then(() => useStore.getState().notify(tr('Link copied')))
  return (
    <div className="flex items-center gap-5 border-t border-line px-4 py-4">
      {link.qr && (
        // Black on white whatever the theme: scanners need it.
        <svg viewBox={`0 0 ${link.qr[0] + 8} ${link.qr[0] + 8}`} shapeRendering="crispEdges" role="img" aria-label={tr('QR code of the phone remote')} className="size-36 shrink-0 rounded-lg">
          <rect width="100%" height="100%" fill="#FFFFFF" />
          <path d={qrPath(link.qr[0], link.qr[1], 4)} fill="#000000" />
        </svg>
      )}
      <div className="flex min-w-0 flex-col gap-2 text-xs text-ink-2">
        <span>{tr('Scan it with the phone’s camera; the phone must be on the same network as this PC. Windows may ask once to let Legato on private networks: allow it.')}</span>
        <span className="truncate font-mono text-ink" title={url}>
          {url}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={copy}>
            {tr('Copy link')}
          </Button>
          <Button variant="ghost" onClick={() => void remoteLink(true)} title={tr('Phones that have the old link lose the remote')}>
            {tr('New link')}
          </Button>
        </span>
      </div>
    </div>
  )
}

/** Under Settings › Playback › Streaming overlay while it's on: the link to add in OBS. */
export function OverlayPanel() {
  const { url, failed } = useOverlay()
  if (failed) return <p className="border-t border-line px-4 py-3 text-xs text-ink-2">{tr('The streaming overlay could not start: another app may be using its port. Turn it off and on again.')}</p>
  if (!url) return null
  const copy = () => void navigator.clipboard.writeText(url).then(() => useStore.getState().notify(tr('Link copied')))
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-line px-4 py-4 text-xs text-ink-2">
      <span>{tr('In OBS: Sources › Add › Browser, then paste this link. Its Custom CSS restyles the card.')}</span>
      <span className="truncate font-mono text-ink" title={url}>
        {url}
      </span>
      <span>
        <Button variant="ghost" onClick={copy}>
          {tr('Copy link')}
        </Button>
      </span>
    </div>
  )
}

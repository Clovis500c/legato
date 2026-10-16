import { Check, Copy, WifiHigh } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type NearbyState, type ShareCode } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { qrPath } from './qr'

/** Same network: 6-digit code to read out ("grandma code"). Offer withdrawn when the panel closes. */
function Nearby({ id }: { id: number }) {
  const [code, setCode] = useState<string>()
  const [status, setStatus] = useState<NearbyState>()
  useEffect(() => () => void api.nearbyStop(), [])
  useEffect(() => {
    if (!code) return
    const t = setInterval(() => api.nearbyStatus().then(setStatus), 1000)
    return () => clearInterval(t)
  }, [code])
  const start = () => {
    setStatus(undefined)
    api
      .nearbySend(id)
      .then(setCode)
      .catch((e) => useStore.setState({ error: String(e) }))
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold">
        <WifiHigh size={16} className="text-ink-2" /> Send to a nearby Music App
      </p>
      {!code || status?.state === 'failed' ? (
        <>
          <p className="text-xs text-ink-2">{status?.state === 'failed' ? status.error : 'Same Wi-Fi or network, a 6-digit code to read out. Windows may ask to allow Music App on private networks.'}</p>
          <Button variant="ghost" className="w-fit" onClick={start}>
            {code ? 'New code' : 'Get a code'}
          </Button>
        </>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[34px] leading-none tracking-[0.12em] tabular-nums">
            {code.slice(0, 3)} {code.slice(3)}
          </span>
          <span className="text-right text-xs text-ink-2">{status?.state === 'sent' ? 'Sent.' : 'On the other app: Add music › Import, type this code. Valid 10 min.'}</span>
        </div>
      )}
    </div>
  )
}

/** Share a playlist: QR code (scan or screenshot) and link (messages). */
export function SharePanel({ id, name, onClose }: { id: number; name: string; onClose: () => void }) {
  const [code, setCode] = useState<ShareCode>()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api
      .sharePlaylist(id)
      .then(setCode)
      .catch((e) => {
        useStore.setState({ error: String(e) })
        onClose()
      })
  }, [id, onClose])
  const copy = () =>
    code &&
    navigator.clipboard.writeText(code.link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })

  return (
    <Dialog title={`Share “${name}”`} kicker={code ? `${formatCount(code.tracks)} tracks · ${formatCount(code.bytes)} bytes` : 'Share'} onClose={onClose}>
      {code && (
        <>
          {code.qr ? (
            <figure className="flex flex-col items-center gap-3">
              {/* Black on white whatever the theme: scanners need it. */}
              <svg viewBox={`0 0 ${code.qr[0] + 8} ${code.qr[0] + 8}`} shapeRendering="crispEdges" role="img" aria-label="QR code of the playlist" className="w-full max-w-72 rounded-lg">
                <rect width="100%" height="100%" fill="#FFFFFF" />
                <path d={qrPath(code.qr[0], code.qr[1], 4)} fill="#000000" />
              </svg>
              <figcaption className="text-center text-xs text-ink-2">Scan it, or send a screenshot: Music App reads the code from the image (drop it on the window).</figcaption>
            </figure>
          ) : (
            <p className="rounded-lg border border-line bg-recess px-3.5 py-3 text-xs">Too many tracks for a QR code: send the link instead.</p>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="kicker">Link · paste it anywhere in Music App (Ctrl+V)</span>
            <div className="flex h-10.5 items-center gap-2.5 rounded-[9px] border border-line bg-raised pr-1.5 pl-3">
              <code className="flex-1 truncate font-mono text-[11px]">{code.link}</code>
              <Button variant="ghost" className="px-2.5! py-1! text-[11px]" onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <Nearby id={id} />
          <p className="text-xs text-ink-2">The code holds the track list only: YouTube and Apple Music ids, or artist and title. No account, no server.</p>
        </>
      )}
    </Dialog>
  )
}

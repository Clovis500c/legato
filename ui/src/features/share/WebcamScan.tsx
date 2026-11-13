import { useEffect, useRef, useState } from 'react'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { readFrame, useWebcam } from './webcam'

/** Frames read a second, and the widest one read (a code is big in a webcam's picture: smaller is faster). */
const EVERY_MS = 150
const WIDE = 480

/** The window that holds the webcam open until it reads one QR code (mounted once in App). Opened by `scanWebcam`: the
 *  camera is asked for here, when it opens, and let go of when it closes; nothing is recorded, nothing is sent. */
export function WebcamScan() {
  const open = useWebcam((s) => s.open)
  return open && <Scanner key={open.id} done={open.done} />
}

function Scanner({ done }: { done: (text: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const end = (text: string | null) => {
    useWebcam.setState({ open: null })
    done(text)
  }
  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: number | undefined
    let over = false
    const canvas = document.createElement('canvas')
    const look = async () => {
      const v = video.current
      if (over || !v || v.videoWidth === 0) return
      const w = Math.min(WIDE, v.videoWidth)
      canvas.width = w
      canvas.height = Math.round((v.videoHeight * w) / v.videoWidth)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const text = await readFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
      if (text && !over) {
        over = true
        useWebcam.setState({ open: null })
        done(text)
      }
    }
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 } }, audio: false })
      .then((s) => {
        if (over) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (video.current) video.current.srcObject = s
        timer = window.setInterval(() => void look(), EVERY_MS)
      })
      .catch(() => setFailed(true))
    return () => {
      over = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [done])
  return (
    <Dialog title={tr('Scan with the webcam')} onClose={() => end(null)}>
      <div className="flex flex-col gap-4">
        {failed ? (
          <p className="text-sm text-ink-2">{tr('The camera could not be opened: check that one is connected and that Windows lets apps use it.')}</p>
        ) : (
          <>
            <video ref={video} autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />
            <p className="text-xs text-ink-2">{tr('Hold the other device’s QR code in front of the camera. Nothing is recorded or sent anywhere.')}</p>
          </>
        )}
        <Button variant="ghost" className="w-fit" onClick={() => end(null)}>
          {tr('Cancel')}
        </Button>
      </div>
    </Dialog>
  )
}

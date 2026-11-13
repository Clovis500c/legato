import { create } from 'zustand'

/** The text of a QR code in one camera frame (RGBA pixels), or null. jsQR loads on first use, so nothing is paid until a scan. */
export async function readFrame(data: Uint8ClampedArray, width: number, height: number): Promise<string | null> {
  const { default: jsQR } = await import('jsqr')
  return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data || null
}

/** The scan window's request: null while closed. `done` gets the code's text, or null when cancelled or refused. */
export const useWebcam = create<{ open: { id: number; done: (text: string | null) => void } | null }>(() => ({ open: null }))

let ids = 0

/** Opens the webcam window (`WebcamScan`) and waits for one QR code: the camera is asked for there, at this call, never before. */
export const scanWebcam = () =>
  new Promise<string | null>((done) => {
    useWebcam.setState({ open: { id: ++ids, done } })
  })

type Shown = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>

/** Calls `leave` when the window hides (minimized, closed to the tray) or the page changes (`onPage`): the camera is
 *  never kept for a view nobody sees. Returns the unsubscribe. */
export function untilLeft(leave: () => void, doc: Shown, onPage: (changed: () => void) => () => void): () => void {
  const seen = () => {
    if (doc.hidden) leave()
  }
  doc.addEventListener('visibilitychange', seen)
  const off = onPage(leave)
  return () => {
    doc.removeEventListener('visibilitychange', seen)
    off()
  }
}

/** Android's side of a permission (`MainActivity.kt`, the app's own page only): the microphone here, songs in phoneMusic.ts. */
export interface PhoneBridge {
  postMessage(text: string): void
  onmessage: ((e: { data: unknown }) => void) | null
}

const bridge = () => (globalThis as unknown as { LegatoMic?: PhoneBridge }).LegatoMic

/** May the phone record? Android's own dialog the first time. No bridge (a PC): true, Rust's error tells. */
export function askMic(mic = bridge()): Promise<boolean> {
  if (!mic) return Promise.resolve(true)
  return new Promise((resolve) => {
    mic.onmessage = (e) => {
      mic.onmessage = null
      resolve(e.data === 'yes')
    }
    mic.postMessage('ask')
  })
}

/** Legato's app info in Android's settings, where its permissions are. */
export function openAppInfo(mic = bridge()) {
  mic?.postMessage('settings')
}

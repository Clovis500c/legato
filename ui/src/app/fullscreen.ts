import { getCurrentWindow } from '@tauri-apps/api/window'

/** Full screen on / off (F11, title bar button). */
export async function toggleFullscreen() {
  const w = getCurrentWindow()
  await w.setFullscreen(!(await w.isFullscreen()))
}

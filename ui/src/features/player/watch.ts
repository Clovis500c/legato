import { create } from 'zustand'
import { api, type WatchCmd, type WatchRect, type WatchReport } from '../../shared/api'
import type { YtUpdate } from './youtube'
import { tr } from '../../shared/i18n/i18n'

/**
 * Videos whose owner turned embedding off (player errors 101 / 150) play from YouTube's own watch page, in a webview
 * Rust places over the video slot (src-tauri ytwatch.rs). Same commands and updates as the embed: the player store
 * drives either one the same way, so pause, seek, volume, fades and next keep working.
 */
export const useWatch = create<{ video: string | null }>(() => ({ video: null }))

/** The watch page plays (this video, if given). */
export function watching(video?: string): boolean {
  const v = useWatch.getState().video
  return v !== null && (video === undefined || v === video)
}

/** Embed command (postMessage protocol names) → watch page command. Others have no meaning there. */
export function watchCommand(func: string, args: unknown[]): WatchCmd | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  switch (func) {
    case 'playVideo':
      return { type: 'play' }
    case 'pauseVideo':
      return { type: 'pause' }
    case 'seekTo':
      return { type: 'seek', seconds: Math.max(0, n(args[0])) }
    case 'setVolume':
      return { type: 'volume', percent: Math.min(100, Math.max(0, n(args[0]))) }
    default:
      return null
  }
}

/** Watch page report → the embed's update. Reports for another video (late, from the page before) are dropped. */
export function watchUpdate(r: WatchReport, video: string): YtUpdate | null {
  if (r.error === 'CONSENT') return { unplayable: tr('YouTube is waiting for a cookie choice; signing in to YouTube Music (Settings › Accounts) usually clears it') }
  if (r.error) return { unplayable: r.reason || r.error }
  if (r.videoId && r.videoId !== video) return null
  return { state: r.state ?? undefined, time: r.time ?? undefined, duration: r.duration || undefined }
}

/** CSS rect → window physical pixels (screen DPI and the interface zoom are both in devicePixelRatio). */
export function physical(r: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, ratio: number): WatchRect {
  return { x: r.left * ratio, y: r.top * ratio, width: r.width * ratio, height: r.height * ratio }
}

/** Opens `video` from `startS` over `rect` (CSS px), or hidden (null: cover mode). */
export function openWatch(video: string, startS: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null) {
  useWatch.setState({ video })
  const r = rect && physical(rect, devicePixelRatio)
  placed = JSON.stringify(r)
  return api.ytwatchOpen(video, startS, r)
}

export function closeWatch() {
  if (!watching()) return
  useWatch.setState({ video: null })
  void api.ytwatchClose().catch(() => {})
}

/** Black bars baked into the video: only the picture shows, like the embed's crop. */
export function cropWatch(box: { x: number; y: number; w: number; h: number }) {
  if (watching()) void api.ytwatchCmd({ type: 'crop', ...box }).catch(() => {})
}

export function sendWatch(func: string, args: unknown[]) {
  const cmd = watchCommand(func, args)
  if (cmd) void api.ytwatchCmd(cmd).catch(() => {})
}

/** Follows the slot (null = hidden: cover mode). Skips repeats: slots report often. */
let placed = ''
export function placeWatch(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null) {
  if (!watching()) return
  const r = rect && physical(rect, devicePixelRatio)
  const key = JSON.stringify(r)
  if (key === placed) return
  placed = key
  void api.ytwatchPlace(r).catch(() => {})
}

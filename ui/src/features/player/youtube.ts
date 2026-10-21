// Official embed driven by same postMessage protocol iframe_api uses.
// No YouTube script in our origin: remote code never gets IPC access.
export const YT_ORIGIN = 'https://www.youtube.com'

/**
 * controls false = YouTube's documented player parameters for a bare video: no control bar, no related videos from
 * other channels, no annotations, no fullscreen button, no player keyboard (our shortcuts do it). start = seconds.
 */
export function embedUrl(videoId: string, origin: string, { controls = false, start = 0, autoplay = true }: { controls?: boolean; start?: number; autoplay?: boolean } = {}) {
  const bare = controls ? '' : '&controls=0&rel=0&iv_load_policy=3&fs=0&disablekb=1'
  const at = start >= 1 ? `&start=${Math.floor(start)}` : ''
  return `${YT_ORIGIN}/embed/${encodeURIComponent(videoId)}?enablejsapi=1&autoplay=${autoplay ? 1 : 0}&playsinline=1${bare}${at}&origin=${encodeURIComponent(origin)}`
}

export function ytPost(frame: HTMLIFrameElement | null, event: 'listening' | 'command', func?: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event, func, args, id: 1, channel: 'widget' }), YT_ORIGIN)
}

/** state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. error: 153 = no Referer. */
export interface YtUpdate {
  state?: number
  time?: number
  duration?: number
  error?: number
  /** Watch page (blocked embeds): the video can't play at all here (region, age, removed). Why, in YouTube's words. */
  unplayable?: string
}

/** Embed message → update. Undefined if not from YouTube or not relevant. */
export function parseYt(origin: string, data: unknown): YtUpdate | undefined {
  if (origin !== YT_ORIGIN || typeof data !== 'string') return
  let msg: { event?: string; info?: unknown }
  try {
    msg = JSON.parse(data)
  } catch {
    return
  }
  const info = msg.info as Record<string, unknown> | number | null
  switch (msg.event) {
    case 'initialDelivery':
    case 'infoDelivery': {
      if (!info || typeof info !== 'object') return
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
      return { state: num(info.playerState), time: num(info.currentTime), duration: num(info.duration) }
    }
    case 'onStateChange':
      return typeof info === 'number' ? { state: info } : undefined
    case 'onError':
      return typeof info === 'number' ? { error: info } : undefined
  }
}

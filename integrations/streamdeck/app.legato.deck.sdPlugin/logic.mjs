// The Stream Deck plugin's logic, pure and tested (../logic.test.mjs): which request a key sends and what a key shows.
// It talks to Legato's phone remote (Settings › Playback › Phone remote) and nothing else: the link that setting shows,
// on this PC or its own network, never beyond. Nothing is sent to the internet.

const KEYS = { playpause: 'toggle', next: 'next', previous: 'previous' }

/** A private address: this PC, or the 10.x, 172.16-31.x, 192.168.x and 169.254.x ranges of a home or office network. */
export function isPrivateHost(host) {
  if (host === 'localhost' || host === '[::1]') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** The phone remote's link as Legato shows it (`http://192.168.1.20:47821/?t=<secret>`) → its base and secret, or null when it is no such link. */
export function parseLink(text) {
  let url
  try {
    url = new URL(String(text).trim())
  } catch {
    return null
  }
  const token = url.searchParams.get('t')
  if (url.protocol !== 'http:' || !token || !isPrivateHost(url.hostname)) return null
  return { base: `${url.protocol}//${url.host}`, token }
}

/** What a key sends: its action's request, or null for an action the plugin doesn't know. Never redirected: Legato
 * doesn't, and a device on the network that did could send the key beyond it. */
export function requestFor(link, action) {
  const t = encodeURIComponent(link.token)
  if (action === 'state') return { method: 'GET', url: `${link.base}/state?t=${t}`, redirect: 'error' }
  const k = KEYS[action]
  return k ? { method: 'POST', url: `${link.base}/key?k=${k}&t=${t}`, redirect: 'error' } : null
}

/** A key's face for what plays (`state`: the remote's /state, null when nothing plays): the title and the artist, cut to fit. */
export function titleOf(state, max = 9) {
  if (!state || typeof state !== 'object' || !state.title) return '–'
  const cut = (s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
  const lines = [cut(String(state.title))]
  if (state.artist) lines.push(cut(String(state.artist)))
  return `${state.playing ? '▶' : '⏸'}\n${lines.join('\n')}`
}

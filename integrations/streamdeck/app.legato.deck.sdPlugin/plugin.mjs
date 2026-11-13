// Legato's Stream Deck plugin: the raw Stream Deck protocol (no dependency), Node's own fetch and WebSocket.
// Not tried on a real Stream Deck (docs/streamdeck.md). The logic is logic.mjs, tested.
import { parseLink, requestFor, titleOf } from './logic.mjs'

const args = {}
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith('-')) args[a.slice(1)] = all[i + 1]
})
const ws = new WebSocket(`ws://127.0.0.1:${args.port}`)
const send = (o) => ws.send(JSON.stringify(o))
/** Contexts of the "Now playing" keys showing. */
const faces = new Set()
let link = null

const ask = async (action) => {
  const r = link && requestFor(link, action)
  if (!r) throw new Error('No link')
  const res = await fetch(r.url, { method: r.method, signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(String(res.status))
  return action === 'state' ? res.json() : null
}

const refresh = async () => {
  if (!faces.size) return
  const title = await ask('state').then(titleOf, () => '!')
  for (const context of faces) send({ event: 'setTitle', context, payload: { title, target: 0 } })
}
setInterval(() => void refresh(), 1500)

ws.addEventListener('open', () => {
  send({ event: args.registerEvent, uuid: args.pluginUUID })
  send({ event: 'getGlobalSettings', context: args.pluginUUID })
})
ws.addEventListener('message', async ({ data }) => {
  const m = JSON.parse(String(data))
  const key = m.action?.split('.').pop()
  if (m.event === 'didReceiveGlobalSettings') link = parseLink(m.payload?.settings?.link ?? '')
  else if (m.event === 'willAppear' && key === 'nowplaying') faces.add(m.context)
  else if (m.event === 'willDisappear') faces.delete(m.context)
  else if (m.event === 'keyDown') {
    try {
      await ask(key === 'nowplaying' ? 'playpause' : key)
    } catch {
      send({ event: 'showAlert', context: m.context })
    }
  }
})

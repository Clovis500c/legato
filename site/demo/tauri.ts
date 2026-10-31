import { answer, art } from './data'

type Handler = (message: unknown) => void

// Nothing the demo does stays in the visitor's browser.
const kept = new Map<string, string>()
const storage = {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
  clear: () => kept.clear(),
  key: (i: number) => [...kept.keys()][i] ?? null,
  get length() {
    return kept.size
  },
}
Object.defineProperty(window, 'localStorage', { value: storage })

const handlers = new Map<number, Handler>()
const listeners = new Map<string, Set<number>>()
let nextId = 1

function transformCallback(callback: Handler = () => {}, once = false) {
  const id = nextId++
  handlers.set(id, (m) => {
    if (once) handlers.delete(id)
    callback(m)
  })
  return id
}

/** As Rust's `emit`. */
export function emit(event: string, payload: unknown) {
  for (const id of listeners.get(event) ?? []) handlers.get(id)?.({ event, id, payload })
}

function plugin(cmd: string, args: Record<string, unknown>) {
  if (cmd === 'plugin:event|listen') {
    const { event, handler } = args as { event: string; handler: number }
    listeners.set(event, (listeners.get(event) ?? new Set()).add(handler))
    return handler
  }
  if (cmd === 'plugin:event|unlisten') {
    const { event, eventId } = args as { event: string; eventId: number }
    listeners.get(event)?.delete(eventId)
    return null
  }
  // Window state: never maximized, never full screen.
  return cmd.includes('|is_') ? false : null
}

Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback,
    unregisterCallback: (id: number) => void handlers.delete(id),
    convertFileSrc: (path: string, scheme: string) => (scheme === 'art' ? art(path) : path),
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => (cmd.startsWith('plugin:') ? plugin(cmd, args) : answer(cmd, args)),
  },
})
Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', { value: { unregisterListener: () => {} } })

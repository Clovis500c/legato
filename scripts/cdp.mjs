// A small Chrome DevTools Protocol client on Node's global WebSocket: no dependency. Legato's WebView2 opens a port when
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS holds --remote-debugging-port=<port> next to background::BROWSER_ARGS (all the
// app's webviews must carry the same flags, docs/notes/v2-handoff.md "Without computer use"). Used by scripts/bench.mjs;
// the E2E smoke test reuses it.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The targets the port lists (pages, iframes, workers). */
export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`DevTools port ${port}: HTTP ${res.status}`)
  return res.json()
}

/** First target `match` accepts, polled: the port opens a moment after launch, the page a moment after that. */
export async function waitForPage(port, { match = (t) => t.type === 'page', timeout = 30000, every = 50 } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    try {
      const found = (await listTargets(port)).find(match)
      if (found) return found
    } catch {
      // Port not open yet.
    }
    if (Date.now() > end) throw new Error(`no page on DevTools port ${port} after ${timeout} ms`)
    await sleep(every)
  }
}

export class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  #listeners = new Map()

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data))
      if (msg.id !== undefined) {
        const p = this.#pending.get(msg.id)
        if (!p) return
        this.#pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`))
        else p.resolve(msg.result)
      } else {
        for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
    ws.addEventListener('close', () => {
      for (const p of this.#pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error(`${p.method}: DevTools connection closed`))
      }
      this.#pending.clear()
    })
  }

  /** `wsUrl` = a target's webSocketDebuggerUrl. */
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`cannot open ${wsUrl}`)), { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}, timeout = 30000) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method}: no answer after ${timeout} ms`))
      }, timeout)
      this.#pending.set(id, { resolve, reject, timer, method })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Listens to a protocol event (after enabling its domain); returns the function that stops listening. */
  on(method, fn) {
    const set = this.#listeners.get(method) ?? new Set()
    set.add(fn)
    this.#listeners.set(method, set)
    return () => set.delete(fn)
  }

  /** Runs an expression in the page (promises awaited); the value comes back as JSON. A throw in the page throws here. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  /** Polls an expression until it is truthy; returns its value. */
  async waitFor(expression, { timeout = 15000, every = 100 } = {}) {
    const end = Date.now() + timeout
    for (;;) {
      const value = await this.evaluate(expression).catch(() => undefined)
      if (value) return value
      if (Date.now() > end) throw new Error(`timed out waiting for: ${expression}`)
      await sleep(every)
    }
  }

  /** A real mouse click at page pixels; count 2 = double click. */
  async click(x, y, { count = 1 } = {}) {
    const at = { x, y, button: 'left', pointerType: 'mouse' }
    await this.send('Input.dispatchMouseEvent', { ...at, type: 'mouseMoved', button: 'none' })
    for (let n = 1; n <= count; n++) {
      await this.send('Input.dispatchMouseEvent', { ...at, type: 'mousePressed', clickCount: n, buttons: 1 })
      await this.send('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased', clickCount: n, buttons: 0 })
    }
  }

  /** A key press: key as the page sees it (' ', 'Enter', 'ArrowRight'), code the physical key ('Space'). A key that types
   *  something sends `text`, and a form submits on Enter's: `enter()`. `vk` = Windows' virtual key code (13 for Enter). */
  async key(key, code = key, { modifiers = 0, text = key.length === 1 ? key : undefined, vk } = {}) {
    const keys = { key, code, modifiers, ...(vk ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}) }
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...keys, text })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keys })
  }

  /** Enter as a keyboard sends it: the focused form submits. */
  enter() {
    return this.key('Enter', 'Enter', { text: '\r', vk: 13 })
  }

  /** PNG of the page, as a Buffer. */
  async screenshot() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(data, 'base64')
  }

  close() {
    this.#ws.close()
  }
}

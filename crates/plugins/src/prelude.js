// Plugin side of the bridge: the `app` object (Promise-based), timers and console. Runs before the plugin's code, in
// the plugin's own QuickJS runtime: no DOM, no network, no files; everything goes through `__host` (Rust).
'use strict'
;(() => {
  const host = globalThis.__host
  const info = JSON.parse(globalThis.__plugin)
  delete globalThis.__host
  delete globalThis.__plugin
  const pending = new Map()
  const handlers = new Map()
  const timers = new Map()
  const commands = new Map()

  const raw = (method, args) => JSON.parse(host(method, JSON.stringify(args ?? {})))
  const call = (method, args) => {
    const r = raw(method, args)
    if ('err' in r) return Promise.reject(new Error(r.err))
    if ('pending' in r) return new Promise((resolve, reject) => pending.set(r.pending, { resolve, reject }))
    return Promise.resolve(r.ok)
  }
  const text = (v) => {
    if (typeof v === 'string') return v
    if (v instanceof Error) return `${v.name}: ${v.message}`
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  const log = (level, args) => raw('log', { level, text: args.map(text).join(' ').slice(0, 2000) })
  globalThis.console = Object.freeze({
    log: (...a) => log('info', a),
    info: (...a) => log('info', a),
    warn: (...a) => log('warn', a),
    error: (...a) => log('error', a),
  })
  const safely = (fn, ...a) => {
    try {
      const r = fn(...a)
      if (r && typeof r.catch === 'function') r.catch((e) => log('error', [e]))
    } catch (e) {
      log('error', [e])
    }
  }

  const timer = (fn, ms, repeat) => {
    if (typeof fn !== 'function') throw new TypeError('setTimeout needs a function')
    const id = raw('timer.set', { ms: Math.max(0, Number(ms) || 0), repeat }).ok
    timers.set(id, { fn, repeat })
    return id
  }
  const clear = (id) => {
    if (timers.delete(id)) raw('timer.clear', { id })
  }
  globalThis.setTimeout = (fn, ms) => timer(fn, ms, false)
  globalThis.setInterval = (fn, ms) => timer(fn, ms, true)
  globalThis.clearTimeout = clear
  globalThis.clearInterval = clear

  globalThis.__dispatch = (kind, json) => {
    const m = JSON.parse(json)
    if (kind === 'reply') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.value)
      else p.reject(new Error(m.error))
    } else if (kind === 'timer') {
      const t = timers.get(m.id)
      if (!t) return
      if (!t.repeat) timers.delete(m.id)
      safely(t.fn)
    } else if (kind === 'event') {
      if (m.name === 'command') {
        const run = commands.get(m.payload?.id)
        if (run) safely(run, m.payload.context ?? null)
      }
      for (const fn of handlers.get(m.name) ?? []) safely(fn, m.payload)
    }
  }

  const app = {
    id: info.id,
    api: info.api,
    appVersion: info.appVersion,
    /** Events: 'track' (song started or null), 'playing' (bool), 'command' ({id, context}), 'panel' ({id, value}). */
    on(event, fn) {
      if (typeof fn !== 'function') throw new TypeError('app.on needs a function')
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
      return () => handlers.set(event, (handlers.get(event) ?? []).filter((f) => f !== fn))
    },
    player: {
      state: () => call('player.state'),
      play: () => call('player.play'),
      pause: () => call('player.pause'),
      toggle: () => call('player.toggle'),
      next: () => call('player.next'),
      previous: () => call('player.previous'),
      seek: (ms) => call('player.seek', { ms }),
      volume: (value) => call('player.volume', { value }),
      playTracks: (ids, start = 0) => call('player.playTracks', { ids, start }),
    },
    library: {
      tracks: () => call('library.tracks'),
      playlists: () => call('library.playlists'),
      playlist: (id) => call('library.playlist', { id }),
    },
    playlists: {
      create: (name) => call('playlists.create', { name }),
      add: (id, trackIds) => call('playlists.add', { id, trackIds }),
    },
    ui: {
      notify: (message) => call('ui.notify', { text: String(message) }),
      /** where: any of 'player', 'track', 'playlist'. run(context) on click. */
      addCommand({ id, title, where = ['player'], run }) {
        if (typeof run === 'function') commands.set(id, run)
        return call('ui.addCommand', { id, title, where })
      },
      removeCommand(id) {
        commands.delete(id)
        return call('ui.removeCommand', { id })
      },
      setPanel: (tree) => call('ui.setPanel', { tree }),
      setStyle: (css) => call('ui.setStyle', { css: String(css) }),
    },
    editor: {
      get: () => call('editor.get'),
      set: (effects) => call('editor.set', { effects }),
    },
    storage: {
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      remove: (key) => call('storage.remove', { key }),
      keys: () => call('storage.keys'),
    },
    net: {
      fetch: (url, opts = {}) => call('net.fetch', { url, method: opts.method, headers: Object.entries(opts.headers ?? {}), body: opts.body }),
    },
  }
  for (const v of Object.values(app)) if (v && typeof v === 'object') Object.freeze(v)
  globalThis.app = Object.freeze(app)
})()

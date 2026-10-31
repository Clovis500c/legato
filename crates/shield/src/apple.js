// Injected by the app into its own Apple Music window only (user's choice 2026-10-31): the user signs in on Apple's page,
// then this reads the playlists and songs the page draws, scrolling at a person's pace. No request of its own, no token,
// no cookie. Starts only when Rust calls window.__legatoApple; answers on WebView2's message channel (checked in Rust).
;(() => {
  if (location.hostname !== 'music.apple.com' || window.top !== window) return
  // Strings only: WebView2 drops objects posted from a remote page. Native stringify, kept before the page's scripts run.
  const stringify = JSON.stringify
  const post = (m) => window.chrome?.webview?.postMessage(`legato-apple:${stringify(m)}`)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Long enough for the list to draw its next rows.
  const pause = () => sleep(350 + Math.random() * 350)
  // data-testid: same in every language (2026-10-31, a playlist's page).
  const ROW = '[data-testid="track-list-item"]'
  const SONG = /\/song\/[^/?#]*\/(\d{1,12})(?:[/?#]|$)/
  const IN_ALBUM = /[?&]i=(\d{1,12})(?:&|$)/
  const LIST = /\/library\/playlist\/(p[l]?\.[A-Za-z0-9-]{4,60})(?:[/?#]|$)/
  const COVER = /^https:\/\/[a-z0-9-]+\.mzstatic\.com\//
  const MAX_SONGS = 3000
  const MAX_LISTS = 500
  const BATCH = 40

  const text = (el) => (el?.textContent ?? '').trim()
  // Pictures load late: the source's first address is there before the img's. Its size is in the name: a bigger one.
  const cover = (root) => {
    const src = root?.querySelector('source')?.srcset?.split(/[\s,]/)[0] || root?.querySelector('img')?.src || ''
    return COVER.test(src) ? src.replace(/\/\d+x\d+bb\.\w+$/, '/300x300bb.jpg') : undefined
  }

  // Nearest ancestor that really scrolls.
  const scrollerOf = (el) => {
    for (let e = el?.parentElement; e; e = e.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 10) return e
    }
    return document.scrollingElement
  }

  const waitFor = async (find) => {
    for (let i = 0; i < 40; i++) {
      const hit = find()
      if (hit) return hit
      await sleep(500)
    }
    return null
  }

  const signedOut = () => !!document.querySelector('[data-testid="sign-in-button"]')

  /** "3:43" or "1:02:03" → ms. */
  const duration = (row) => {
    const m = text(row.querySelector('[data-testid="track-duration"]')).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/)
    return m ? ((+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]) * 1000 : undefined
  }

  /** One row. The catalog id when the row links to it; a song of the user's own files has none, its names do. */
  const song = (row) => {
    const title = text(row.querySelector('[data-testid="track-title"]'))
    if (!title) return null
    const by = row.querySelector('[data-testid="track-title-by-line"]')
    const named = [...(by?.querySelectorAll('[data-testid="click-action"]') ?? [])].map(text).filter(Boolean)
    const artists = named.length ? [...new Set(named)] : [text(by)].filter(Boolean)
    const hrefs = [...row.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    const id = hrefs.map((h) => h.match(SONG)?.[1] ?? h.match(IN_ALBUM)?.[1]).find(Boolean)
    const album = text(row.querySelector('[data-testid="track-column-tertiary"]')) || undefined
    return { id, title, artists, album, ms: duration(row), art: cover(row) }
  }

  /** "50 songs, 2 hours" in any language: its first number, separators dropped. */
  const listed = () => {
    const m = text(document.querySelector('[data-testid="tracklist-footer-description"]')).match(/^[\d\s.,  ]+/)
    return m ? Number(m[0].replace(/\D/g, '')) || 0 : 0
  }

  const read = async () => {
    const first = await waitFor(() => document.querySelector(ROW) ?? (signedOut() ? document.body : null))
    if (!first) return
    if (signedOut()) throw new Error('signed out')
    const box = scrollerOf(first)
    const seen = new Set()
    const count = Math.min(listed() || Infinity, MAX_SONGS)
    let still = 0
    while (still < 20 && seen.size < count) {
      const fresh = []
      const rows = document.querySelectorAll(ROW)
      for (const row of rows) {
        // The row's place, not the song's: a playlist can hold a song twice.
        const key = row.getAttribute('data-row')
        if (key === null || seen.has(key)) continue
        seen.add(key)
        const s = song(row)
        if (s) fresh.push(s)
      }
      const total = listed()
      for (let i = 0; i < fresh.length; i += BATCH) post({ rows: fresh.slice(i, i + BATCH), total })
      // Long lists load in parts as the page reaches their end.
      const last = rows[rows.length - 1]
      if (last) box.scrollTop += last.getBoundingClientRect().top - box.getBoundingClientRect().top
      still = fresh.length ? 0 : still + 1
      await pause()
    }
    // Rust reports it as not read: a cut list must not replace a whole copy.
    if (count !== Infinity && seen.size < count) throw new Error('list cut short')
  }

  // All Playlists: a grid, the cover and the name both link to the list.
  const lists = async () => {
    const link = () => [...document.querySelectorAll('a[href*="/library/playlist/"]')].find((a) => !a.closest('nav'))
    const first = await waitFor(() => link() ?? (signedOut() ? document.body : null))
    if (signedOut()) throw new Error('signed out')
    if (!first) return post({ lists: [] })
    const box = scrollerOf(first)
    const seen = new Map()
    let still = 0
    while (still < 4 && seen.size < MAX_LISTS) {
      const before = seen.size
      for (const a of document.querySelectorAll('a[href*="/library/playlist/"]')) {
        if (a.closest('nav')) continue
        const id = a.getAttribute('href').match(LIST)?.[1]
        if (!id) continue
        const was = seen.get(id) ?? { id, name: '', cover: undefined }
        const card = a.closest('li') ?? a.parentElement
        seen.set(id, { id, name: was.name || text(a), cover: was.cover ?? cover(a) ?? cover(card) })
      }
      const end = box.scrollTop + box.clientHeight >= box.scrollHeight - 4
      still = seen.size > before || !end ? 0 : still + 1
      box.scrollTop += box.clientHeight * 0.8
      await pause()
    }
    const all = [...seen.values()].filter((l) => l.name)
    for (let i = 0; i < all.length; i += BATCH) post({ lists: all.slice(i, i + BATCH) })
    post({ lists: [] })
  }

  // One at a time; a call while one runs does nothing (Rust asks again until the page is up).
  let busy = false
  const once = (job) => async () => {
    if (busy) return
    busy = true
    post({ started: true })
    try {
      await job()
      post({ done: true })
    } catch (e) {
      post({ error: String(e).slice(0, 180) })
    }
    busy = false
  }
  window.__legatoApple = { read: once(read), lists: once(lists) }
})()

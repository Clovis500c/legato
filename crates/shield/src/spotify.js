// Injected by the app into its own Spotify window only (user's choice 2026-10-31): the user signs in on Spotify's page,
// then this reads the lists and songs the page draws, scrolling at a person's pace. No request of its own, no token, no
// cookie. Starts only when Rust calls window.__legatoSpotify; answers on WebView2's message channel (checked in Rust).
;(() => {
  if (location.hostname !== 'open.spotify.com' || window.top !== window) return
  // Strings only: WebView2 drops objects posted from a remote page. Native stringify, kept before the page's scripts run.
  const stringify = JSON.stringify
  const post = (m) => window.chrome?.webview?.postMessage(`legato-spotify:${stringify(m)}`)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // Long enough for the virtual list to draw its next rows.
  const pause = () => sleep(350 + Math.random() * 350)
  const ROW = '[data-testid="tracklist-row"]'
  const TRACK = /\/track\/([A-Za-z0-9]{22})/
  const COVER = /^https:\/\/(i\.scdn\.co|mosaic\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com)\//
  const MAX_SONGS = 3000
  const MAX_LISTS = 500
  const BATCH = 40

  const text = (el) => (el?.textContent ?? '').trim()
  const cover = (root) => {
    const src = root?.querySelector('img')?.src ?? ''
    return COVER.test(src) ? src : undefined
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

  /** "3:43" or "1:02:03" → ms. */
  const duration = (row) => {
    const m = (row.innerText ?? '').match(/(?:^|\s)(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/)
    return m ? ((+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]) * 1000 : undefined
  }

  /** One row; podcasts' episodes and local files have no track link: left out. */
  const song = (row) => {
    const link = row.querySelector('a[href*="/track/"]')
    const id = link?.getAttribute('href')?.match(TRACK)?.[1]
    if (!id) return null
    const artists = [...new Set([...row.querySelectorAll('a[href*="/artist/"]')].map(text).filter(Boolean))]
    return { id, title: text(link), artists, album: text(row.querySelector('a[href*="/album/"]')) || undefined, ms: duration(row), art: cover(row) }
  }

  // The list's own grid: a playlist's page has others under it (Recommended).
  const read = async () => {
    const first = await waitFor(() => document.querySelector(ROW))
    if (!first) return
    const grid = first.closest('[role="grid"]') ?? document
    // The grid's rows count its header.
    const total = Math.max(0, (Number(grid.getAttribute?.('aria-rowcount')) || 0) - 1)
    const box = scrollerOf(first)
    const seen = new Set()
    const count = Math.min(total || Infinity, MAX_SONGS)
    let still = 0
    while (still < 20 && seen.size < count) {
      const fresh = []
      const rows = grid.querySelectorAll(ROW)
      for (const row of rows) {
        // The row's place, not the song's: a playlist can hold a song twice.
        const key = row.closest('[aria-rowindex]')?.getAttribute('aria-rowindex') ?? row.querySelector('a[href*="/track/"]')?.getAttribute('href')
        if (!key || seen.has(key)) continue
        seen.add(key)
        const s = song(row)
        if (s) fresh.push(s)
      }
      for (let i = 0; i < fresh.length; i += BATCH) post({ rows: fresh.slice(i, i + BATCH), total })
      // Long lists load in parts and a row exists once loaded: past the last one the list is blank, and rows it skips
      // never draw. So the last row goes to the top, and the next ones are waited for there.
      const last = rows[rows.length - 1]
      if (last) box.scrollTop += last.getBoundingClientRect().top - box.getBoundingClientRect().top
      still = fresh.length ? 0 : still + 1
      await pause()
    }
    // Rust reports it as not read: a cut list must not replace a whole copy.
    if (total && seen.size < count) throw new Error('list cut short')
  }

  // The library's column: virtual too, albums and artists share it. A row's id says its kind, in any language; its
  // subtitle names the owner, never the song count. Its rows have no links; the home page's playlists do.
  const TITLE = '#Desktop_LeftSidebar_Id p[id^="listrow-title-spotify:playlist:"]'
  const lists = async () => {
    const first = await waitFor(() => document.querySelector(TITLE))
    if (!first) {
      if (document.querySelector('[data-testid="login-button"]')) throw new Error('signed out')
      return post({ lists: [] })
    }
    const box = scrollerOf(first)
    const seen = new Map()
    let still = 0
    while (still < 4 && seen.size < MAX_LISTS) {
      const before = seen.size
      for (const title of document.querySelectorAll(TITLE)) {
        const id = title.id.split(':').pop()
        if (!seen.has(id)) seen.set(id, { id, name: text(title), cover: cover(title.closest('[role="row"]')) })
      }
      const end = box.scrollTop + box.clientHeight >= box.scrollHeight - 4
      still = seen.size > before || !end ? 0 : still + 1
      box.scrollTop += box.clientHeight * 0.8
      await pause()
    }
    const all = [...seen.values()]
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
  window.__legatoSpotify = { read: once(read), lists: once(lists) }
})()

// Injected by the app into every frame; only YouTube embeds act.
// While Google limits a network (many requests from it: an import's searches), it answers some of the player's requests
// with its "Sorry…" page (403, after about 7 s) or 429. The embed then waits for good, black and silent, with no event
// (2026-11-01: a third of the starts, for hours after an import's 1840 searches). Said at once to the app that loaded
// it, which loads the video again. Read from resource timings: YouTube's own code (fetch) stays untouched.
;(() => {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) || !location.pathname.startsWith('/embed/')) return
  // Only the app that loaded it (its origin is in the embed URL) hears it.
  const app = new URLSearchParams(location.search).get('origin')
  if (!app || typeof PerformanceObserver !== 'function') return
  const stringify = JSON.stringify
  const PLAYER = /\/youtubei\/v1\/player(\?|$)/
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if ((e.responseStatus === 403 || e.responseStatus === 429) && PLAYER.test(e.name)) parent.postMessage(stringify({ legato: 'refused', status: e.responseStatus }), app)
    }
  }).observe({ type: 'resource' })
})()

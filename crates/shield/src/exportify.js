// Injected by the app into its Exportify window only (user's ask 2026-10-31: no step to do, no file to see). Presses the
// page's own two buttons, so its own code reads and saves as for anyone. Spotify's consent page is the user's: never touched.
;(() => {
  if (location.hostname !== 'exportify.app' || window.top !== window) return
  const TRIES = 'legato-sign-ins'
  const ASKED = 'legato-exported'
  // Watched from Rust (spotify_export.rs): no IPC here, strings only.
  const post = (m) => window.chrome?.webview?.postMessage(`legato-exportify:${m}`)
  // Back from Spotify (code, or a refusal): the page's to handle, never sent back there.
  const home = location.search === ''
  // Any change on the page while it reads, its progress bar first. No count: silence is the only sign.
  const watchReading = () => {
    let sent = 0
    const busy = () => {
      if (Date.now() - sent < 5000) return
      sent = Date.now()
      post('busy')
    }
    busy()
    new MutationObserver(busy).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  }
  let stuck = 0
  const tick = setInterval(() => {
    const all = document.querySelector('th.export button:not([disabled])')
    if (all) {
      clearInterval(tick)
      post('ready')
      // Once for this window: its page can come back after it, and a second file would start a second import.
      if (sessionStorage.getItem(ASKED)) return
      sessionStorage.setItem(ASKED, '1')
      watchReading()
      return all.click()
    }
    const login = document.querySelector('#loginButton:not([disabled])')
    if (!login) return
    post('ready')
    const tries = Number(sessionStorage.getItem(TRIES)) || 0
    if (home && tries < 2) {
      clearInterval(tick)
      sessionStorage.setItem(TRIES, tries + 1)
      return login.click()
    }
    // Sign-in button still there 6 s on: not a code being swapped for access, no way in.
    if (++stuck >= 12) {
      clearInterval(tick)
      post('refused')
    }
  }, 500)
})()

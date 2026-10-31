// Injected by the app into its Exportify window only (user's ask 2026-10-31: no step to do, no file to see). Presses the
// page's own two buttons, so its own code reads and saves as for anyone. Spotify's consent page is the user's: never touched.
;(() => {
  if (location.hostname !== 'exportify.app' || window.top !== window) return
  const TRIES = 'legato-sign-ins'
  const ASKED = 'legato-exported'
  // Back from Spotify (code, or a refusal): the page's to handle, never sent back there.
  const home = location.search === ''
  const tick = setInterval(() => {
    const all = document.querySelector('th.export button:not([disabled])')
    if (all) {
      clearInterval(tick)
      // Once for this window: its page can come back after it, and a second file would start a second import.
      if (sessionStorage.getItem(ASKED)) return
      sessionStorage.setItem(ASKED, '1')
      return all.click()
    }
    const login = home && document.querySelector('#loginButton:not([disabled])')
    const tries = Number(sessionStorage.getItem(TRIES)) || 0
    if (!login || tries >= 2) return
    clearInterval(tick)
    sessionStorage.setItem(TRIES, tries + 1)
    login.click()
  }, 500)
})()

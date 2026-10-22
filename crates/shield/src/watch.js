// Injected by the app into its own YouTube watch-page webview only: videos whose owner turned embedding off (player
// errors 101 / 150) play from youtube.com/watch, YouTube's own player and page. Everything around the player is hidden,
// the player fills the webview, YouTube's controls and overlays stay hidden: the app's controls drive it.
// Talks to the app through WebView2's message channel (checked in Rust); takes commands through window.__musicAppWatch.
;(() => {
  if (location.hostname !== 'www.youtube.com' || window.top !== window) return
  // Strings only: WebView2 drops objects posted from this page. Native stringify, kept before the page's scripts run.
  const stringify = JSON.stringify
  const post = (m) => window.chrome?.webview?.postMessage(`musicapp-ytwatch:${stringify(m)}`)
  // Ancestors must not contain the fixed player (transform / contain make a new containing block).
  const ANCESTORS = 'ytd-app, ytd-page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner, #player, #player-container-outer, #player-container-inner, #player-container, ytd-player, #container, #full-bleed-container'
  const AROUND = '#masthead-container, #guide, tp-yt-app-drawer, ytd-mini-guide-renderer, #secondary, #below, #chat, #panels, #related, ytd-popup-container, tp-yt-iron-overlay-backdrop, ytd-consent-bump-v2-lightbox, ytd-engagement-panel-section-list-renderer, ytd-merch-shelf-renderer'
  const OVERLAYS =
    '.ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom, .ytp-pause-overlay, .ytp-watermark, .ytp-impression-link, .ytp-large-play-button, .ytp-cued-thumbnail-overlay, .ytp-cards-button, .ytp-cards-teaser, .ytp-ce-element, .ytp-endscreen-content, .html5-endscreen, .videowall-endscreen, .ytp-upnext, .ytp-autonav-endscreen-countdown-overlay, .ytp-paid-content-overlay, .ytp-suggested-action, .ytp-featured-product, .ytp-tooltip, .ytp-bezel, .ytp-bezel-text-wrapper, .ytp-spinner, .ytp-unmute, .ytp-contextmenu, .ytp-popup, .ytp-iv-player-content, .iv-branding, .annotation, .ytp-caption-window-container'
  const css = `
html, body { background: #000 !important; overflow: hidden !important; }
${ANCESTORS} { transform: none !important; contain: none !important; filter: none !important; will-change: auto !important; }
${AROUND}, ${OVERLAYS} { display: none !important; }
#movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; pointer-events: none !important; }
#movie_player .html5-video-container { width: 100vw !important; height: 100vh !important; left: 0 !important; top: 0 !important; overflow: hidden !important; }
/* --x --y --w --h: the picture inside the frame (black bars cut, set by the app). Default: whole frame, fitted. */
#movie_player video { position: absolute !important; width: calc(100vw / var(--w, 1)) !important; height: calc(100vh / var(--h, 1)) !important; left: calc(-100vw * var(--x, 0) / var(--w, 1)) !important; top: calc(-100vh * var(--y, 0) / var(--h, 1)) !important; object-fit: var(--fit, contain) !important; }
`
  const style = document.createElement('style')
  style.textContent = css
  const keep = () => {
    const host = document.head || document.documentElement
    if (host && !style.isConnected) host.appendChild(style)
  }
  keep()
  new MutationObserver(keep).observe(document, { childList: true, subtree: true })

  const player = () => {
    const p = document.getElementById('movie_player')
    return p && typeof p.getPlayerState === 'function' ? p : null
  }
  const text = (t) => (t ? (t.simpleText ?? (t.runs ?? []).map((r) => r.text).join('')) : '')
  let failed = false
  // Silent until the app sends its volume: the page must never play louder than the app.
  let volumeSet = false
  // Reports on every state change, else once a second (the app's clock runs smooth between reports).
  let last = ''
  let sent = 0
  setInterval(() => {
    const p = player()
    if (!p || failed) return
    if (!volumeSet && !p.isMuted()) p.mute()
    // Cookie choice not made yet (new profile, EU): YouTube holds playback until it's answered, and its dialog is
    // hidden here. The user answers it on YouTube themselves; never clicked for them.
    if (document.querySelector('ytd-consent-bump-v2-lightbox tp-yt-paper-dialog')?.opened) {
      failed = true
      return post({ error: 'CONSENT' })
    }
    const status = p.getPlayerResponse?.()?.playabilityStatus
    if (status?.status && status.status !== 'OK') {
      // Region, age, removed, private: the app says why and moves on.
      failed = true
      return post({ error: status.status, reason: String(status.reason ?? text(status.errorScreen?.playerErrorMessageRenderer?.reason) ?? '').slice(0, 300) })
    }
    const state = p.getPlayerState()
    // Ended: stop here, YouTube's autoplay would open another video.
    if (state === 0) p.pauseVideo()
    // ready = waiting for the app's volume and crop (commands sent before this script ran are lost).
    const cropped = !!document.documentElement.style.getPropertyValue('--w')
    const key = `${state}|${volumeSet}|${cropped}`
    if (key === last && Date.now() - sent < 1000) return
    last = key
    sent = Date.now()
    post({ state, time: p.getCurrentTime(), duration: p.getDuration(), videoId: p.getVideoData?.().video_id ?? '', ready: !volumeSet, cropped })
  }, 250)

  window.__musicAppWatch = {
    cmd(name, value) {
      const p = player()
      if (!p) return
      if (name === 'play') p.playVideo()
      else if (name === 'pause') p.pauseVideo()
      else if (name === 'seek') p.seekTo(value, true)
      else if (name === 'crop') {
        const [x, y, w, h] = value
        const root = document.documentElement.style
        Object.entries({ '--x': x, '--y': y, '--w': w, '--h': h, '--fit': 'fill' }).forEach(([k, v]) => root.setProperty(k, String(v)))
      } else if (name === 'volume') {
        volumeSet = true
        if (p.isMuted()) p.unMute()
        p.setVolume(value)
      }
    },
  }
  // Clicks: the app's own play / pause, never YouTube's (links, menus).
  addEventListener(
    'click',
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      post({ click: true })
    },
    true,
  )
  addEventListener('contextmenu', (e) => e.preventDefault(), true)
})()

// Injected by the app into every frame; only bare YouTube embeds (controls=0) act.
// Hides everything YouTube draws over the video: title bar, share, logo, cards, end screen, cued thumbnail, unmute,
// up next, pause overlay, bezel, spinner, error slate; the new embed player's controls layer too. The app's controls drive the player and show errors.
// Two layers: an adopted sheet (works before <head> exists) and a <style> element. The page can replace
// document.adoptedStyleSheets (that dropped ours: overlay seen "sometimes"); both are put back if they go.
;(() => {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) || !location.pathname.startsWith('/embed/')) return
  if (new URLSearchParams(location.search).get('controls') !== '0') return
  const HIDE = [
    '.ytp-chrome-top',
    '.ytp-chrome-top-buttons',
    '.ytp-title',
    '.ytp-show-cards-title',
    '.ytp-gradient-top',
    '.ytp-gradient-bottom',
    '.ytp-chrome-bottom',
    '.ytp-pause-overlay',
    '.ytp-pause-overlay-container',
    '.ytp-watermark',
    '.ytp-youtube-button',
    '.ytp-impression-link',
    '.ytp-large-play-button',
    '.ytp-cued-thumbnail-overlay',
    '.ytp-cards-button',
    '.ytp-cards-teaser',
    '.ytp-ce-element',
    '.ytp-endscreen-content',
    '.html5-endscreen',
    '.videowall-endscreen',
    '.ytp-videowall-still',
    '.ytp-upnext',
    '.ytp-autonav-endscreen-countdown-overlay',
    '.ytp-paid-content-overlay',
    '.ytp-suggested-action',
    '.ytp-featured-product',
    '.ytp-tooltip',
    '.ytp-bezel',
    '.ytp-bezel-text-wrapper',
    '.ytp-spinner',
    '.ytp-unmute',
    '.ytp-error',
    '.ytp-offline-slate',
    '.ytp-contextmenu',
    '.ytp-popup',
    '.ytp-generic-popup',
    '.ytp-iv-player-content',
    '.iv-branding',
    '.branding-img',
    '.annotation',
    // New embed player (seen 2026-10-22): its own controls layer, title, middle buttons, cover thumbnail, end-screen
    // recommendations, "Watch on YouTube".
    '.ytPlayerControlsContainerHost',
    '.new-controls',
    '.player-controls-content',
    '.fullscreen-controls',
    '.ytmVideoCoverHost',
    '.ytFullscreenVideoRecommendationsHost',
    '.watch-on-youtube-button-wrapper',
  ]
  const css = `${HIDE.join(',')}{display:none!important}`
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const style = document.createElement('style')
  style.textContent = css
  const keep = () => {
    if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const host = document.head || document.documentElement
    if (host && !style.isConnected) host.appendChild(style)
  }
  keep()
  // Cheap check per batch of changes: the player rewrites its DOM, the page may swap sheets.
  new MutationObserver(keep).observe(document, { childList: true, subtree: true })
})()

// Injected by the app into every frame; only bare YouTube embeds (controls=0) act.
// Hides YouTube's own overlays: title bar, share, "More videos", logo, cards, end screen. The app's controls drive it.
;(() => {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) || !location.pathname.startsWith('/embed/')) return
  if (new URLSearchParams(location.search).get('controls') !== '0') return
  const HIDE = [
    '.ytp-chrome-top',
    '.ytp-gradient-top',
    '.ytp-gradient-bottom',
    '.ytp-pause-overlay',
    '.ytp-watermark',
    '.ytp-youtube-button',
    '.ytp-impression-link',
    '.ytp-large-play-button',
    '.ytp-cards-button',
    '.ytp-cards-teaser',
    '.ytp-ce-element',
    '.ytp-endscreen-content',
    '.html5-endscreen',
    '.ytp-paid-content-overlay',
    '.ytp-suggested-action',
    '.ytp-featured-product',
    '.ytp-tooltip',
    '.iv-branding',
    '.branding-img',
  ]
  // Before the page parses: adopted sheet needs no <head>.
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`${HIDE.join(',')}{display:none!important}`)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
})()

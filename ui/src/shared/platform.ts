/** Phone build (Android's or iOS's WebView): texts that speak of a PC say phone there. The phone layout is `usePhone`. */
export const phoneApp = typeof navigator !== 'undefined' && /Android|iPhone|iPad/.test(navigator.userAgent)

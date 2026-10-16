// Injected by the app into every frame; only YouTube frames act.
// Drops ad slots from player data before the player reads it ("json-prune" approach).
;(() => {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return
  const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams']
  const prune = (o) => {
    if (o && typeof o === 'object') {
      for (const k of KEYS) delete o[k]
      if (o.playerResponse) prune(o.playerResponse)
    }
    return o
  }
  const parse = JSON.parse
  JSON.parse = function (...args) {
    return prune(parse.apply(this, args))
  }
  const json = Response.prototype.json
  Response.prototype.json = function () {
    return json.call(this).then(prune)
  }
  // Watch pages set it inline before the player boots.
  let initial
  Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => initial, set: (v) => (initial = prune(v)) })
})()

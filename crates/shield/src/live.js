// Injected into YouTube frames (the embed, and the watch page of videos that can't be embedded). Live processing of the
// video's sound with Chromium's own audio nodes: the app sends settings, the frame sends levels back. Same settings and
// levels as the native engine (crates/dsp). Off until asked: the sound is untouched.
//
// The sound is taken with captureStream() (the element itself is then muted), not createMediaElementSource(): that one
// can't be undone, and a failure would leave the video silent. Here, off or failing = unmute, back to normal.
;(() => {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return
  const embed = location.pathname.startsWith('/embed/')
  const watch = location.pathname === '/watch'
  if (!embed && !watch) return
  // Embed: only the app that loaded it (its origin is in the embed URL) talks to it.
  const app = embed ? new URLSearchParams(location.search).get('origin') : null
  const stringify = JSON.stringify
  const send = (m) => {
    if (embed && app) parent.postMessage(stringify({ musicApp: 'live', ...m }), app)
    else if (watch) window.chrome?.webview?.postMessage(`musicapp-live:${stringify(m)}`)
  }

  // Adaptive Sound, same as crates/dsp processor.rs.
  const MAX_CUT = -12
  const MAX_BOOST = 9
  const HOLD_BELOW = -45
  // Gain time constant; quicker while a song is new (first seconds), so it settles fast.
  const GLIDE_S = 2.5
  const GLIDE_START_S = 0.6
  const START_S = 3
  const lufs = (ms) => (ms <= 1e-12 ? -120 : -0.691 + 10 * Math.log10(ms))
  const db = (g) => 10 ** (g / 20)
  // Playing this long with nothing captured: capture doesn't work here, the element gets its sound back.
  const SILENT_GIVE_UP_S = 4
  const MUTED = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted')

  let settings = { on: false, adaptive: false, targetLufs: -14 }
  // { ctx, video, stream, track, src, gain, limiter, shelf, raw, k, wanted, … } while attached.
  let g = null
  let busy = false
  let retry = 0
  // Last error sent (retries don't repeat it), and the source given up on (capture gave nothing).
  let said = ''
  let skip = ''

  function report(error) {
    if (error === said) return
    said = error
    send({ attached: false, error })
  }

  function detach() {
    if (!g) return
    const s = g
    g = null
    clearInterval(s.timer)
    // Sound back first, to the element's own mute as the page last set it: whatever happens next, the video is heard.
    delete s.video.muted
    MUTED.set.call(s.video, s.wanted)
    s.video.removeEventListener('volumechange', s.onVolume)
    s.stream.removeEventListener('addtrack', s.plug)
    s.stream.removeEventListener('removetrack', s.plug)
    s.ctx.close().catch(() => {})
    send({ attached: false })
  }

  // Two analysers per point (left / right): loudness sums both channels, as BS.1770 and the native meter do.
  function pair(ctx, from) {
    const split = ctx.createChannelSplitter(2)
    from.connect(split)
    return [0, 1].map((c) => {
      const a = new AnalyserNode(ctx, { fftSize: 2048 })
      split.connect(a, c)
      return a
    })
  }

  async function attach() {
    const video = document.querySelector('video')
    if (!video || g || busy || !settings.on || (video.currentSrc && video.currentSrc === skip)) return
    busy = true
    let ctx
    try {
      const stream = video.captureStream()
      ctx = new AudioContext({ latencyHint: 'playback' })
      // Stereo in (mono is spread to both sides), then gain → peak limiter → speakers.
      const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
      const gain = ctx.createGain()
      // Peak limiter, engaged only while boosting (ratio 1 = untouched otherwise).
      const limiter = new DynamicsCompressorNode(ctx, { threshold: -1, knee: 0, ratio: 1, attack: 0.003, release: 0.12 })
      input.connect(gain).connect(limiter).connect(ctx.destination)
      // K-weighting (BS.1770) on the analysis branch, before the gain.
      const shelf = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 1681, gain: 4 })
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 38.1, Q: 0.5 })
      input.connect(shelf).connect(hp)
      const k = pair(ctx, hp)
      const raw = pair(ctx, input)
      await ctx.resume()
      if (ctx.state !== 'running') throw new Error('Sound processing is waiting for a click in the app')
      if (!settings.on || g || document.querySelector('video') !== video) return void ctx.close()
      const s = { ctx, video, stream, input, gain, limiter, k, raw, buf: new Float32Array(2048), track: null, src: null, wanted: video.muted, momentary: 0, short: 0, peak: 0, gainDb: 0, elapsed: 0, at: performance.now(), time: video.currentTime, silent: 0 }
      // The captured track changes with each video (new metadata): follow it.
      s.plug = () => {
        const track = stream.getAudioTracks().find((t) => t.readyState === 'live') ?? null
        if (track === s.track) return
        // Next song: loudness measured afresh, the gain carries on from the last one.
        s.momentary = s.short = s.elapsed = 0
        s.src?.disconnect()
        s.track = track
        s.src = track ? s.ctx.createMediaStreamSource(new MediaStream([track])) : null
        s.src?.connect(input)
      }
      s.onVolume = () => setGain()
      // From here, detach() undoes everything (the catch below too): the element always gets its sound back.
      g = s
      ctx = null
      // The page keeps its own mute (what it sets is what it reads, YouTube's mute button too); the element itself
      // stays muted: its sound now comes out of here.
      Object.defineProperty(video, 'muted', {
        configurable: true,
        get: () => s.wanted,
        set: (v) => {
          if (s.wanted === !!v) return
          s.wanted = !!v
          setGain()
          video.dispatchEvent(new Event('volumechange'))
        },
      })
      MUTED.set.call(video, true)
      video.addEventListener('volumechange', s.onVolume)
      stream.addEventListener('addtrack', s.plug)
      stream.addEventListener('removetrack', s.plug)
      s.plug()
      setGain()
      s.timer = setInterval(tick, 33)
      said = ''
      send({ attached: true })
    } catch (e) {
      ctx?.close().catch(() => {})
      detach()
      report(String(e?.message ?? e).slice(0, 200))
    } finally {
      busy = false
    }
  }

  // The element's own volume (the app's volume and fades) no longer reaches the captured sound: applied here.
  function setGain() {
    if (!g) return
    const level = g.wanted ? 0 : g.video.volume * db(g.gainDb)
    g.gain.gain.setTargetAtTime(level, g.ctx.currentTime, 0.03)
    g.limiter.ratio.value = g.gainDb > 0.1 ? 20 : 1
  }

  // Sum of squares and peak of one analyser pair.
  function read(pair) {
    let sum = 0
    let peak = 0
    for (const a of pair) {
      a.getFloatTimeDomainData(g.buf)
      for (const x of g.buf) {
        sum += x * x
        peak = Math.max(peak, Math.abs(x))
      }
    }
    return { ms: sum / g.buf.length, peak }
  }

  function tick() {
    if (!g) return
    if (g.ctx.state !== 'running') {
      detach()
      return report('Sound processing stopped')
    }
    // The page swapped its video element (rare): follow it.
    if (document.querySelector('video') !== g.video) {
      detach()
      return void attach()
    }
    g.plug()
    const now = performance.now()
    const dt = Math.min(0.2, (now - g.at) / 1000)
    g.at = now
    // Paused: one last report, then quiet until it plays again.
    if (g.video.paused && g.idle) return
    g.idle = g.video.paused
    const { ms } = read(g.k)
    const { peak } = read(g.raw)
    // Playing, yet nothing captured: capture doesn't work for this source. Normal sound for it, no retry until the next.
    const v = g.video
    const playing = !v.paused && v.currentTime !== g.time
    g.time = v.currentTime
    g.silent = playing && peak < 1e-6 ? g.silent + dt : 0
    if (g.silent > SILENT_GIVE_UP_S) {
      skip = v.currentSrc
      detach()
      return report('No sound could be taken from this video')
    }
    // Windows not full yet (song start): plain average of all so far, as the native meter does.
    g.elapsed += dt
    const soFar = g.elapsed > 0 ? dt / g.elapsed : 1
    g.momentary += (ms - g.momentary) * Math.max(soFar, 1 - Math.exp(-dt / 0.4))
    g.short += (ms - g.short) * Math.max(soFar, 1 - Math.exp(-dt / 3))
    g.peak = Math.max(peak, g.peak * 10 ** -dt)
    const mom = lufs(g.momentary)
    const short = lufs(g.short)
    let want = 0
    if (settings.adaptive) want = mom < HOLD_BELOW ? g.gainDb : Math.min(MAX_BOOST, Math.max(MAX_CUT, settings.targetLufs - short))
    g.gainDb += (want - g.gainDb) * (1 - Math.exp(-dt / (g.elapsed < START_S ? GLIDE_START_S : GLIDE_S)))
    setGain()
    // fast: this read alone (the analysers hold ~43 ms).
    send({ levels: { fast: lufs(ms), momentary: mom, short, peak: g.peak, gain: g.gainDb } })
  }

  function apply(next) {
    if (!next || typeof next !== 'object') return
    const t = Number(next.targetLufs)
    settings = { on: next.on === true, adaptive: next.adaptive === true, targetLufs: Number.isFinite(t) ? Math.min(-6, Math.max(-30, t)) : -14 }
    if (!settings.on) {
      clearInterval(retry)
      retry = 0
      said = ''
      return detach()
    }
    setGain()
    void attach()
    // Not attached yet (no video yet, sound blocked until a click, new source after a give-up): try again now and then.
    if (!retry) retry = setInterval(() => void attach(), 2000)
  }

  if (embed) {
    addEventListener('message', (e) => {
      if (e.origin !== app || e.source !== parent || typeof e.data !== 'string') return
      let m
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      if (m && m.musicApp === 'live') apply(m.settings)
    })
  } else {
    // Watch page: Rust calls this (fixed shape, numbers and booleans only).
    window.__musicAppLive = { set: (s) => apply(s) }
  }
})()

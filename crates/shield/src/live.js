// Injected into YouTube frames (the embed, and the watch page of videos that can't be embedded). Live processing of the
// video's sound with Chromium's own audio nodes: the app sends settings, the frame sends levels back. Same settings and
// levels as the native engine (crates/dsp). Off until asked: the sound is untouched.
//
// The sound is taken with captureStream() (the element itself muted once captured sound proves it works), not
// createMediaElementSource(): that one can't be undone, and a failure would leave the video silent. Here, off, failing
// or not proven yet = the element's own sound, back to normal.
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
  // Momentary this far under short-term: the music is falling away (an ending), the gain holds.
  const FALLING_DB = 10
  // Gain time constant; quicker while a song is new (first seconds), so it settles fast.
  const GLIDE_S = 2.5
  const GLIDE_START_S = 0.6
  const START_S = 3
  const lufs = (ms) => (ms <= 1e-12 ? -120 : -0.691 + 10 * Math.log10(ms))
  const db = (g) => 10 ** (g / 20)
  // The element is muted only once captured sound proves the capture works (until then it plays its own sound,
  // unprocessed): a silent intro or a capture that gives nothing never leaves a video silent, nothing is given up on.
  // Playing this long with nothing captured: said once, still listening in case sound comes.
  const SILENT_SAY_S = 20
  // Captured sound gone this long while processing (track swap, ad, a silent break): the element's own sound back
  // until it returns.
  const LOST_S = 2
  // Captured peak above this = sound (digital silence reads 0).
  const SOUND = 1e-4
  // Early end (ui player/ends.ts): the song over before the video, silence after it (an end screen). Quiet (this read)
  // for QUIET_S within the video's last END_S: said once per song, from where it went quiet.
  // shortcut: a song with 2 s of silence then a final part in its last 25 s ends at the silence (learned as such),
  // add a check against the song's known length if users report cut endings.
  const QUIET_LUFS = -50
  const QUIET_S = 2
  const END_S = 25
  const MUTED = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted')

  // Live Editor, same settings and order as crates/dsp (effects.rs, chain.rs, stretch.rs). Speed and tempo: the
  // video's own rate (pitch kept or not); pitch alone: two sweeping delay taps (no worklet: YouTube's policy blocks
  // them); then EQ, compressor, width, echo, reverb (same Freeverb layout as reverb.rs), 3D / 8D (Chromium's HRTF
  // panner), balance.
  const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  const OLD_EQ = [60, 250, 1000, 4000, 12000]
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  const ALLPASSES = [556, 441, 341, 225]
  const SPREAD = 23
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  /** Saved gains onto the 10 bands; 5 = an older edit, its curve read at the new bands (effects.rs `eq_from`). */
  function eqFrom(g) {
    if (g.length !== OLD_EQ.length || !g.every((x) => typeof x === 'number')) return EQ_FREQS.map((_, i) => g[i])
    return EQ_FREQS.map((f) => {
      const i = OLD_EQ.findIndex((o) => o > f)
      if (i === 0) return g[0]
      if (i < 0) return g[4]
      return g[i - 1] + (Math.log2(f / OLD_EQ[i - 1]) / Math.log2(OLD_EQ[i] / OLD_EQ[i - 1])) * (g[i] - g[i - 1])
    })
  }

  /** Trust boundary, like Effects::clamped. */
  function cleanFx(e) {
    const o = e && typeof e === 'object' ? e : {}
    const r = o.reverb || {}
    const c = o.echo || {}
    const s = o.space || {}
    const eq = eqFrom(Array.isArray(o.eq) ? o.eq : [])
    return {
      on: o.on !== false,
      speed: num(o.speed, 0.25, 2.5, 1),
      tempo: num(o.tempo, 0.25, 2.5, 1),
      pitch: num(o.pitch, -24, 24, 0),
      bass: num(o.bass, 0, 24, 0),
      eq: eq.map((g) => num(g, -24, 24, 0)),
      reverb: { mix: num(r.mix, 0, 1, 0), size: num(r.size, 0, 1, 0.7), damping: num(r.damping, 0, 1, 0.4), predelayMs: num(r.predelayMs, 0, 250, 20) },
      echo: { mix: num(c.mix, 0, 1, 0), timeMs: num(c.timeMs, 20, 2000, 300), feedback: num(c.feedback, 0, 0.95, 0.3) },
      space: { on: s.on === true, azimuth: num(s.azimuth, -180, 180, 0), elevation: num(s.elevation, -90, 90, 0), distance: num(s.distance, 0.25, 10, 1), rotate: s.rotate === true, periodS: num(s.periodS, 1, 60, 8), room: num(s.room, 0, 1, 0.2) },
      drive: num(o.drive, 0, 1, 0),
      compress: num(o.compress, 0, 1, 0),
      width: num(o.width, 0, 3, 1),
      balance: num(o.balance, -1, 1, 0),
    }
  }
  const fitRate = (r) => Math.min(4, Math.max(0.25, r))
  const rates = (e) => (e.on ? [fitRate(e.speed * e.tempo), fitRate(e.speed * 2 ** (e.pitch / 12))] : [1, 1])
  /** Effects change the sound (effects.rs `neutral`, negated). */
  const edited = (e) => {
    const [t, p] = rates(e)
    return e.on && !(t === 1 && p === 1 && e.bass === 0 && e.eq.every((x) => x === 0) && e.reverb.mix === 0 && e.echo.mix === 0 && !e.space.on && e.drive === 0 && e.compress === 0 && e.width === 1 && e.balance === 0)
  }

  /** Stereo 2×2 mix: set(ll, lr, rl, rr) = left→left, left→right, right→left, right→right. */
  function matrix(ctx, from) {
    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    from.connect(split)
    const gains = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, o]) => {
      const n = new GainNode(ctx, { gain: i === o ? 1 : 0 })
      split.connect(n, i)
      n.connect(merge, 0, o)
      return n
    })
    return { output: merge, set: (...v) => gains.forEach((n, i) => n.gain.setTargetAtTime(v[i], ctx.currentTime, 0.02)) }
  }

  /** Freeverb layout, as reverb.rs: mono sum in, 8 damped combs, 4 allpasses, per side. */
  function freeverb(ctx) {
    const scale = ctx.sampleRate / 44100
    // Mono downmix averages: twice the native input gain (it sums).
    const input = new GainNode(ctx, { gain: 0.03, channelCount: 1, channelCountMode: 'explicit' })
    const pre = new DelayNode(ctx, { maxDelayTime: 0.25, delayTime: 0.02 })
    input.connect(pre)
    const output = ctx.createChannelMerger(2)
    const combs = []
    ;[0, SPREAD].forEach((offset, side) => {
      const sum = new GainNode(ctx)
      for (const len of COMBS) {
        const d = new DelayNode(ctx, { maxDelayTime: 1, delayTime: ((len + offset) * scale) / ctx.sampleRate })
        const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: -6 })
        const fb = new GainNode(ctx, { gain: 0.896 })
        pre.connect(d)
        d.connect(lp).connect(fb).connect(d)
        d.connect(sum)
        combs.push({ lp, fb })
      }
      let node = sum
      for (const len of ALLPASSES) {
        // w = x + 0.5 · delay(w); y = delay(w) − x
        const w = new GainNode(ctx)
        const d = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: ((len + offset) * scale) / ctx.sampleRate })
        const back = new GainNode(ctx, { gain: 0.5 })
        const neg = new GainNode(ctx, { gain: -1 })
        const y = new GainNode(ctx)
        node.connect(w)
        w.connect(d)
        d.connect(back).connect(w)
        d.connect(y)
        node.connect(neg).connect(y)
        node = y
      }
      node.connect(output, 0, side)
    })
    const set = (size, damping, predelayMs) => {
      const fb = 0.7 + 0.28 * size
      const dmp = 0.4 * damping
      // One-pole damping pole → cutoff of the stand-in lowpass.
      const cutoff = dmp > 0.001 ? Math.min(20000, (-Math.log(dmp) * ctx.sampleRate) / (2 * Math.PI)) : 20000
      for (const c of combs) {
        c.fb.gain.setTargetAtTime(fb, ctx.currentTime, 0.05)
        c.lp.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.05)
      }
      pre.delayTime.setTargetAtTime(Math.max(0, predelayMs) / 1000, ctx.currentTime, 0.02)
    }
    return { input, output, set }
  }

  /**
   * Pitch alone (the video's rate already set the speed): two delay taps whose delays sweep half a window apart,
   * each faded in and out (raised cosine) so the resets are never heard. Oscillators start together: phase-locked.
   */
  function pitchShifter(ctx) {
    const W = 0.08
    const f = 1 / W
    const input = new GainNode(ctx)
    const output = new GainNode(ctx)
    const dry = new GainNode(ctx, { gain: 1 })
    const wet = new GainNode(ctx, { gain: 0 })
    input.connect(dry).connect(output)
    const H = 64
    const saw = (shift) => {
      const real = new Float32Array(H)
      const imag = new Float32Array(H)
      for (let k = 1; k < H; k++) imag[k] = shift ? -2 / (Math.PI * k) : (2 * (k % 2 ? 1 : -1)) / (Math.PI * k)
      return new PeriodicWave(ctx, { real, imag, disableNormalization: true })
    }
    const cos = new PeriodicWave(ctx, { real: new Float32Array([0, 1]), imag: new Float32Array(2), disableNormalization: true })
    const t0 = ctx.currentTime + 0.05
    const taps = [false, true].map((shift) => {
      const d = new DelayNode(ctx, { maxDelayTime: 1 })
      const sweep = new OscillatorNode(ctx, { frequency: f, periodicWave: saw(shift) })
      const depth = new GainNode(ctx, { gain: 0 })
      sweep.connect(depth).connect(d.delayTime)
      const env = new GainNode(ctx, { gain: 0.5 })
      const fade = new OscillatorNode(ctx, { frequency: f, periodicWave: cos })
      const fadeDepth = new GainNode(ctx, { gain: shift ? -0.5 : 0.5 })
      fade.connect(fadeDepth).connect(env.gain)
      input.connect(d).connect(env).connect(wet)
      sweep.start(t0)
      fade.start(t0)
      return { d, depth, nodes: [sweep, fade] }
    })
    wet.connect(output)
    const set = (ratio) => {
      const on = Math.abs(ratio - 1) > 1e-4
      const span = Math.abs(1 - ratio) * W
      for (const t of taps) {
        t.d.delayTime.value = span / 2 + 0.005
        // Rising delay = lower pitch; falling = higher.
        t.depth.gain.setTargetAtTime(ratio < 1 ? span / 2 : -span / 2, ctx.currentTime, 0.01)
      }
      dry.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.02)
      wet.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02)
    }
    return { input, output, set }
  }

  /** The whole Live Editor graph between the captured sound and the gain. */
  function buildFx(ctx) {
    const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit' })
    const shifter = pitchShifter(ctx)
    input.connect(shifter.input)
    const filters = [new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 100, gain: 0 }), ...EQ_FREQS.map((frequency, i) => new BiquadFilterNode(ctx, { type: i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking', frequency, Q: 1.41, gain: 0 }))]
    let node = shifter.output
    for (const fl of filters) {
      node.connect(fl)
      node = fl
    }
    // Distortion: chain.rs `distortion`, y = scale · tanh(drive · x). No curve = passes through.
    const shaper = new WaveShaperNode(ctx, { oversample: '4x' })
    let shaped = 0
    node.connect(shaper)
    node = shaper
    const comp = new DynamicsCompressorNode(ctx, { knee: 6, attack: 0.005, release: 0.15 })
    const compOn = new GainNode(ctx, { gain: 0 })
    const compOff = new GainNode(ctx, { gain: 1 })
    const afterComp = new GainNode(ctx)
    node.connect(comp).connect(compOn).connect(afterComp)
    node.connect(compOff).connect(afterComp)
    const width = matrix(ctx, afterComp)
    const afterEcho = new GainNode(ctx)
    const echo = new DelayNode(ctx, { maxDelayTime: 2.05, delayTime: 0.3 })
    const echoFb = new GainNode(ctx, { gain: 0.3 })
    const echoWet = new GainNode(ctx, { gain: 0 })
    width.output.connect(afterEcho)
    width.output.connect(echo)
    echo.connect(echoFb).connect(echo)
    echo.connect(echoWet).connect(afterEcho)
    const reverb = freeverb(ctx)
    const dry = new GainNode(ctx, { gain: 1 })
    const wet = new GainNode(ctx, { gain: 0 })
    const afterReverb = new GainNode(ctx)
    afterEcho.connect(dry).connect(afterReverb)
    afterEcho.connect(reverb.input)
    reverb.output.connect(wet).connect(afterReverb)
    const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 1, channelCount: 1, channelCountMode: 'explicit' })
    const spaceOn = new GainNode(ctx, { gain: 0 })
    const spaceOff = new GainNode(ctx, { gain: 1 })
    const afterSpace = new GainNode(ctx)
    afterReverb.connect(spaceOff).connect(afterSpace)
    afterReverb.connect(panner).connect(spaceOn).connect(afterSpace)
    let room = null
    const balance = matrix(ctx, afterSpace)
    let fx = cleanFx(null)
    let azimuth = 0
    const place = (deg, when) => {
      const a = (deg * Math.PI) / 180
      const el = (fx.space.elevation * Math.PI) / 180
      const d = fx.space.distance
      const p = [d * Math.cos(el) * Math.sin(a), d * Math.sin(el), -d * Math.cos(el) * Math.cos(a)]
      ;[panner.positionX, panner.positionY, panner.positionZ].forEach((param, i) => param.linearRampToValueAtTime(p[i], when))
    }
    const t = () => ctx.currentTime
    const to = (param, v) => param.setTargetAtTime(v, t(), 0.02)
    function set(next) {
      fx = next
      const on = fx.on
      const e = on ? fx : cleanFx(null)
      const [time, pitch] = rates(e)
      shifter.set(Math.abs(pitch - 1) < 1e-6 || Math.abs(pitch - time) < 1e-6 ? 1 : pitch / time)
      to(filters[0].gain, e.bass)
      e.eq.forEach((gdb, i) => to(filters[i + 1].gain, gdb))
      if (e.drive !== shaped) {
        shaped = e.drive
        const drive = 10 ** ((30 * e.drive) / 20)
        const scale = 0.25 / Math.tanh(drive * 0.25)
        shaper.curve = e.drive > 0 ? Float32Array.from({ length: 2049 }, (_, i) => scale * Math.tanh(drive * (i / 1024 - 1))) : null
      }
      const a = Math.min(1, Math.max(0, e.compress))
      comp.threshold.value = -6 - 24 * a
      comp.ratio.value = 1 + 7 * a
      to(compOn.gain, a > 0 ? 1 : 0)
      to(compOff.gain, a > 0 ? 0 : 1)
      const wa = (1 + e.width) / 2
      const wb = (1 - e.width) / 2
      width.set(wa, wb, wb, wa)
      to(echo.delayTime, e.echo.timeMs / 1000)
      to(echoFb.gain, e.echo.feedback)
      to(echoWet.gain, e.echo.mix)
      reverb.set(e.reverb.size, e.reverb.damping, e.reverb.predelayMs)
      // reverb.rs `levels`: as loud as the dry song whatever the room.
      const mix = Math.min(1, Math.max(0, e.reverb.mix))
      to(dry.gain, 1 - 0.5 * mix)
      to(wet.gain, 1.75 * Math.sqrt(mix) * (1 - (0.7 + 0.28 * e.reverb.size) ** 2) ** 0.26)
      to(spaceOn.gain, e.space.on ? 1 : 0)
      to(spaceOff.gain, e.space.on ? 0 : 1)
      if (e.space.on && e.space.room > 0 && !room) {
        room = { verb: freeverb(ctx), gain: new GainNode(ctx, { gain: 0 }) }
        room.verb.set(0.5, 0.6, 20)
        panner.connect(room.verb.input)
        room.verb.output.connect(room.gain).connect(afterSpace)
      }
      if (room) to(room.gain.gain, e.space.on ? e.space.room * 0.6 * Math.min(2, e.space.distance) : 0)
      if (!e.space.rotate) azimuth = e.space.azimuth
      place(azimuth, t() + 0.03)
      const pan = ((e.balance + 1) * Math.PI) / 4
      balance.set(Math.cos(pan) * Math.SQRT2, 0, 0, Math.sin(pan) * Math.SQRT2)
    }
    /** Every tick: 8D goes round. */
    function turn(dt) {
      if (!fx.on || !fx.space.on || !fx.space.rotate) return
      azimuth += (360 * dt) / fx.space.periodS
      if (azimuth > 180) azimuth -= 360
      place(azimuth, t() + Math.max(0.04, dt * 1.5))
    }
    return { input, output: balance.output, set, turn, rates: () => rates(fx.on ? fx : cleanFx(null)) }
  }

  // listen = levels only (cover pulse, early ends): the element plays its own sound, untouched, and this only listens.
  // ending = the app fades the song out (the gain holds); gain = where a new song's gain starts (the app's last song,
  // which may have played in the other embed), null = this frame's own.
  let settings = { on: false, listen: false, adaptive: false, targetLufs: -14, ending: false, bands: false, gain: null }
  let effects = cleanFx(null)
  // { ctx, video, stream, track, src, full, gain, limiter, fx, raw, k, wanted, … } while attached; full = the sound
  // comes out of here (gain, limiter, fx), else they are null.
  let g = null
  let busy = false
  let retry = 0
  // Last error sent (retries don't repeat it).
  let said = ''

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
    if (s.full) {
      // Sound back first, to the element's own mute as the page last set it: whatever happens next, the video is heard.
      delete s.video.muted
      MUTED.set.call(s.video, s.wanted)
      s.video.removeEventListener('volumechange', s.onVolume)
      s.video.removeEventListener('ratechange', s.onRate)
      s.video.playbackRate = 1
      s.video.preservesPitch = true
    }
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
      const a = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0 })
      split.connect(a, c)
      return a
    })
  }

  async function attach() {
    const video = document.querySelector('video')
    if (!video || g || busy || !settings.on) return
    busy = true
    let ctx
    try {
      const stream = video.captureStream()
      ctx = new AudioContext({ latencyHint: 'playback' })
      const full = !settings.listen
      // Stereo in (mono is spread to both sides), then effects → gain → peak limiter → speakers. Listening only: the
      // analysers alone (Chromium pulls them unconnected), the element keeps its own sound.
      const input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
      let tap = input
      let gain = null
      let limiter = null
      let post = null
      let direct = null
      let gate = null
      if (full) {
        gain = ctx.createGain()
        // Peak limiter, engaged only while boosting or edited (ratio 1 = untouched otherwise).
        limiter = new DynamicsCompressorNode(ctx, { threshold: -1, knee: 0, ratio: 1, attack: 0.003, release: 0.12 })
        // Straight to the gain until the Live Editor is used: its graph (two reverbs, a 3D panner, a pitch shifter)
        // costs CPU even when neutral. Then through it for good (fxOn).
        post = new GainNode(ctx)
        direct = new GainNode(ctx)
        // Closed until the capture is proven (prove): the element's own sound meanwhile, never both.
        gate = new GainNode(ctx, { gain: 0 })
        input.connect(direct).connect(post)
        post.connect(gain).connect(limiter).connect(gate).connect(ctx.destination)
        tap = post
      }
      // K-weighting (BS.1770) on the analysis branch: after the effects, before the gain (as the native chain).
      const shelf = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 1681, gain: 4 })
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 38.1, Q: 0.5 })
      tap.connect(shelf).connect(hp)
      const k = pair(ctx, hp)
      const raw = pair(ctx, tap)
      await ctx.resume()
      if (ctx.state !== 'running') throw new Error('Sound processing is waiting for a click in the app')
      if (!settings.on || g || document.querySelector('video') !== video || full === settings.listen) return void ctx.close()
      const s = { ctx, video, stream, input, full, fx: null, post, direct, gain, limiter, gate, proven: false, told: false, k, raw, buf: new Float32Array(2048), track: null, src: null, wanted: video.muted, momentary: 0, short: 0, peak: 0, gainDb: full ? startGain(0) : 0, elapsed: 0, at: performance.now(), time: video.currentTime, silent: 0, quietAt: null, endSaid: false }
      // The captured track changes with each video (new metadata): follow it.
      s.plug = () => {
        const track = stream.getAudioTracks().find((t) => t.readyState === 'live') ?? null
        if (track === s.track) return
        // Next song: loudness measured afresh, the gain carries on from the last one (the app's, across embeds).
        s.momentary = s.short = s.elapsed = s.silent = 0
        s.quietAt = null
        s.endSaid = false
        // New source: proven again before the element goes quiet.
        prove(s, false)
        s.told = false
        if (track && full) s.gainDb = startGain(s.gainDb)
        s.src?.disconnect()
        s.track = track
        s.src = track ? s.ctx.createMediaStreamSource(new MediaStream([track])) : null
        s.src?.connect(input)
      }
      s.onVolume = () => setGain()
      // YouTube may put its own rate back (new video, seek): ours again.
      s.onRate = () => {
        if (Math.abs(video.playbackRate - s.rate) > 1e-3) applyRate()
      }
      // From here, detach() undoes everything (the catch below too): the element always gets its sound back.
      g = s
      ctx = null
      if (full) {
        // The page keeps its own mute (what it sets is what it reads, YouTube's mute button too); the element itself
        // stays muted: its sound now comes out of here.
        Object.defineProperty(video, 'muted', {
          configurable: true,
          get: () => s.wanted,
          set: (v) => {
            if (s.wanted === !!v) return
            s.wanted = !!v
            if (!s.proven) MUTED.set.call(video, s.wanted)
            setGain()
            video.dispatchEvent(new Event('volumechange'))
          },
        })
        video.addEventListener('volumechange', s.onVolume)
        video.addEventListener('ratechange', s.onRate)
        fxOn()
        applyRate()
      }
      stream.addEventListener('addtrack', s.plug)
      stream.addEventListener('removetrack', s.plug)
      s.plug()
      setGain()
      s.timer = setInterval(tick, 33)
    } catch (e) {
      ctx?.close().catch(() => {})
      detach()
      report(String(e?.message ?? e).slice(0, 200))
    } finally {
      busy = false
    }
  }

  /**
   * Live Editor in use (even bypassed: A / B flips at once after): its graph built and faded in, the direct path
   * faded out and kept silent. Once per attach.
   */
  function fxOn() {
    if (!g?.full || g.fx || !edited({ ...effects, on: true })) return
    const fx = buildFx(g.ctx)
    fx.set(effects)
    const wet = new GainNode(g.ctx, { gain: 0 })
    g.input.connect(fx.input)
    fx.output.connect(wet).connect(g.post)
    wet.gain.setTargetAtTime(1, g.ctx.currentTime, 0.015)
    g.direct.gain.setTargetAtTime(0, g.ctx.currentTime, 0.015)
    g.fx = fx
  }

  /** Capture proven (sound came) or not: processing, the element muted, its sound from here; else the element's own. */
  function prove(s, on) {
    if (s.proven === on) return
    s.proven = on
    if (s.full) {
      MUTED.set.call(s.video, on || s.wanted)
      s.gate.gain.setTargetAtTime(on ? 1 : 0, s.ctx.currentTime, 0.005)
    }
    if (on) {
      said = ''
      send({ attached: true })
    }
  }

  /** Gain a new song starts from: the app's, used once (a mid-song track change keeps `own`). */
  function startGain(own) {
    const from = settings.adaptive && settings.gain !== null ? settings.gain : own
    settings = { ...settings, gain: null }
    return from
  }

  // The element's own volume (the app's volume and fades) no longer reaches the captured sound: applied here.
  function setGain() {
    if (!g?.full) return
    const level = g.wanted ? 0 : g.video.volume * db(g.gainDb)
    g.gain.gain.setTargetAtTime(level, g.ctx.currentTime, 0.03)
    // Effects before the gain can push peaks over too (bass boost).
    g.limiter.ratio.value = g.gainDb > 0.1 || edited(effects) ? 20 : 1
  }

  /** Speed and tempo on the video itself: pitch kept for tempo alone, else follows (the shifter corrects pitch). */
  function applyRate() {
    if (!g?.full) return
    const [time, pitch] = g.fx?.rates() ?? [1, 1]
    g.rate = time
    g.video.preservesPitch = Math.abs(pitch - 1) < 1e-6
    if (Math.abs(g.video.playbackRate - time) > 1e-3) g.video.playbackRate = time
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

  // Visualizer bands (crates/dsp spectrum.rs): each bin's power into the nearest of 16 bands (centers 50 · 2^(i·8/15)
  // Hz), both channels averaged, in dB. +8.2: a sine's power through the analyser's Blackman window and 1/N scale
  // reads 8.2 dB under the native band-passes.
  function bands(pair) {
    const n = pair[0].frequencyBinCount
    const hz = g.ctx.sampleRate / pair[0].fftSize
    if (!g.freq) g.freq = new Float32Array(n)
    const power = new Array(16).fill(0)
    for (const a of pair) {
      a.getFloatFrequencyData(g.freq)
      for (let k = 1; k < n; k++) {
        const i = Math.round((15 / 8) * Math.log2((k * hz) / 50))
        if (i >= 0 && i < 16) power[i] += 10 ** (g.freq[k] / 10) / pair.length
      }
    }
    return power.map((p) => (p > 1e-12 ? 10 * Math.log10(p) + 8.2 : -120))
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
    g.fx?.turn(dt)
    // Paused: one last report, then quiet until it plays again.
    if (g.video.paused && g.idle) return
    g.idle = g.video.paused
    const { ms } = read(g.k)
    const { peak } = read(g.raw)
    // Sound captured: processing. Silent while playing: the element's own sound back after LOST_S; never any sound
    // for SILENT_SAY_S: said (the video plays as usual meanwhile).
    const v = g.video
    const playing = !v.paused && v.currentTime !== g.time
    g.time = v.currentTime
    const sound = peak > SOUND
    g.silent = playing && !sound ? g.silent + dt : 0
    if (sound) prove(g, true)
    else if (g.proven && g.silent > LOST_S) prove(g, false)
    else if (!g.proven && !g.told && g.silent > SILENT_SAY_S) {
      g.told = true
      report('No sound could be taken from this video')
    }
    // Windows not full yet (song start): plain average of all so far, as the native meter does.
    g.elapsed += dt
    const soFar = g.elapsed > 0 ? dt / g.elapsed : 1
    g.momentary += (ms - g.momentary) * Math.max(soFar, 1 - Math.exp(-dt / 0.4))
    g.short += (ms - g.short) * Math.max(soFar, 1 - Math.exp(-dt / 3))
    g.peak = Math.max(peak, g.peak * 10 ** -dt)
    const mom = lufs(g.momentary)
    const short = lufs(g.short)
    if (g.full) {
      let want = 0
      // The app fading the song out, silence, or the music falling away: hold (processor.rs `wanted_db`).
      if (settings.adaptive) want = settings.ending || mom < HOLD_BELOW || mom < short - FALLING_DB ? g.gainDb : Math.min(MAX_BOOST, Math.max(MAX_CUT, settings.targetLufs - short))
      g.gainDb += (want - g.gainDb) * (1 - Math.exp(-dt / (g.elapsed < START_S ? GLIDE_START_S : GLIDE_S)))
      setGain()
    }
    // fast: this read alone (the analysers hold ~43 ms).
    const fast = lufs(ms)
    // Early end: quiet near the video's end for QUIET_S (a seek back starts over).
    const t = v.currentTime
    if (fast >= QUIET_LUFS || !(v.duration - t < END_S) || (g.quietAt !== null && t < g.quietAt)) g.quietAt = null
    else if (playing && g.quietAt === null) g.quietAt = t
    if (g.quietAt !== null && !g.endSaid && t - g.quietAt >= QUIET_S) {
      g.endSaid = true
      send({ end: g.quietAt })
    }
    send({ levels: { fast, momentary: mom, short, peak: g.peak, gain: g.gainDb, ...(settings.bands && { bands: bands(g.raw) }) } })
  }

  function apply(next, fx) {
    if (!next || typeof next !== 'object') return
    if (fx !== undefined) {
      effects = cleanFx(fx)
      if (g) {
        fxOn()
        g.fx?.set(effects)
        applyRate()
        setGain()
      }
    }
    const t = Number(next.targetLufs)
    // A start gain waits for its song (the next track): later messages without one keep it.
    settings = { on: next.on === true, listen: next.listen === true, adaptive: next.adaptive === true, targetLufs: Number.isFinite(t) ? Math.min(-6, Math.max(-30, t)) : -14, ending: next.ending === true, bands: next.bands === true, gain: num(next.gain, MAX_CUT, MAX_BOOST, settings.gain) }
    if (!settings.on) {
      clearInterval(retry)
      retry = 0
      said = ''
      return detach()
    }
    // Listening ↔ processing: attached again the other way (below).
    if (g && g.full === settings.listen) detach()
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
      if (m && m.musicApp === 'live') apply(m.settings, m.effects)
    })
  } else {
    // Watch page: Rust calls this (fixed shape, numbers and booleans only).
    window.__musicAppLive = { set: (s, e) => apply(s, e) }
  }
})()

# Visualizer v2

Today: `features/player/Visualizer.tsx` (16 DOM bars, 48 px under the cover, looks bars / mirror / peaks / wave),
`bars.ts` (pure maths), `crates/dsp/src/spectrum.rs` (16 band-passes, half an octave apart, ~50 ms mean square),
`crates/shield/src/live.js` `bands()` (same bands from Chromium's analyser bins, +8.2 dB calibration), levels polled
by `features/player/live.ts` every 33 ms (`player_levels`), YouTube's in each report (33 ms timer).

Goal: realistic (what a hi-fi analyser shows) and detailed (many bands, stereo, beat), without costing the CPU.

## Data

### FFT spectrum with log bands

- **Sees**: bars that follow the music finely (a hi-hat lights the top, a bass note one bar, not a third of them).
- **How**: native: `rustfft` (or `realfft`) on the mono mix and per channel, Hann window, 4096 points at 48 kHz
  (~85 ms, 11.7 Hz bins), hop 1024 (50 % overlap at 60 Hz needs hop 800: pick hop = rate / 60). Bins summed into
  bands of 1/3, 1/6 or 1/12 octave between 20 Hz and 20 kHz (31, 62, 120 bands), ANSI / IEC centers; low bands that
  are narrower than a bin interpolate between bins. `live.js`: `AnalyserNode.fftSize = 4096`, same mapping, same
  window correction (analyser uses Blackman: calibrate like the +8.2 dB today). Keep `spectrum.rs` for the meter-like
  16-band look or retire it once the FFT bands cover it.
- **Rules**: visual only (nothing stored, nothing sent). Formulas alike in both twins (CLAUDE.md).
- **Needs**: nothing.
- **Effort**: M. **Risk**: CPU of a 4096 FFT at 60 Hz (cheap: ~50 µs per FFT), real-time thread safety (run it on a
  copy outside the audio callback: a lock-free ring buffer from the engine thread).
- **Done when**: Rust and JS tests: a sine at each 1/12-octave center lights its band within 0.5 dB and its neighbours
  are 15 dB under; both twins give the same values on the same signal (shared fixture).

### Weighting and tilt

- **Sees**: Settings: Weighting None / A / ITU-R 468; Tilt 0 / +3 / +4.5 dB per octave (music looks level, not a ramp
  falling to the right).
- **How**: per-band gain table computed once (A-weighting formula, 468 curve table), added in dB.
- **Effort**: S. **Done when**: pink noise reads flat ±1 dB with +3 dB/oct tilt (test).

### Stereo and time-domain blocks

- **Sees**: looks that show left vs right, a waveform, stereo width.
- **How**: per-channel bands (two FFTs), and the last 1024 samples per channel decimated to 512 for the scope and
  vectorscope. `live.js`: `ChannelSplitter` → two analysers (already two per point), `getFloatTimeDomainData`.
- **Effort**: S on top of the FFT. **Done when**: a left-only sine shows only on the left.

### Beat and onset detection

- **Sees**: pulses on kicks, flashes on drops, the radial look breathing with the beat, BPM shown in Now Playing.
- **How**: spectral flux on low (40-150 Hz) and full bands, adaptive threshold (median of the last second × k),
  onset events; tempo by autocorrelation of the onset curve over 8 s (60-200 BPM, octave errors folded). Pure Rust
  in `crates/dsp/src/beat.rs`, its JS twin in `live.js`.
- **Effort**: M. **Risk**: false beats on ambient music (confidence value; looks fade the effect when low).
- **Done when**: a click track at 120 BPM gives 120 ± 1; ten real songs within 2 % or a clean octave (test fixtures
  from local public-domain files only).

### Loudness for meters

- **Sees**: LUFS and true-peak meters.
- **How**: Adaptive Sound's BS.1770 momentary / short-term values already exist on both sides: send them in the frame.
- **Effort**: S.

### Push at 60 Hz

- **Sees**: smooth motion with no stutter, no wasted CPU when the visualizer is hidden.
- **How**: a Tauri `Channel` opened by the visualizer (native: Rust pushes frames at 60 Hz while subscribed); a packed
  binary frame: bands as u8 (0.5 dB steps over 120 dB), samples as i16, beat flags, LUFS as f32. YouTube's frames
  already come by `postMessage` from `live.js`: same packing, rate raised to 60 Hz only while a visualizer listens
  (`bands` wish in `live.ts`). Front end interpolates between frames at the screen's refresh.
- **Rules**: "No network from the front end" untouched (IPC only).
- **Effort**: M. **Risk**: IPC cost (120 bytes × 60/s is nothing).
- **Done when**: CPU of the whole app with the visualizer open measured under +3 % on the bench PC.

## Renderer

### One canvas in a worker

- **How**: `OffscreenCanvas` transferred to a Web Worker; frames posted to it; Canvas 2D for bars, curves, meters,
  scope; WebGL2 for spectrogram, 3D terrain, particles, presets. Pause when the page is hidden or the element is off
  screen (IntersectionObserver); 30 fps when Windows' battery saver is on (ask Rust); `devicePixelRatio` sizing.
- **Effort**: M. **Done when**: the main thread's frame time unchanged with the visualizer on (Performance panel).

### Sizes and places

- **Sees**: the strip under the cover (today), a large backdrop behind Now Playing, full screen (F or double click),
  the mini player, the OBS overlay; click to cycle looks, right-click for its menu (look, colours, bands).
- **Effort**: S per place once the renderer exists.

### Colours

- **Sees**: Theme (accent), Cover (its palette from `coverTint.ts`), Spectrum (a rainbow from low to high), Heat (by
  level), a custom gradient picked in Theme Studio.
- **Effort**: S.

### Comfort

- **How**: Windows' "Show animations" off (read from Rust) or `prefers-reduced-motion` → slower looks, no flashes, no
  camera moves. Always: no more than 3 flashes per second (photosensitive epilepsy guidance), large bright changes
  smoothed.
- **Effort**: S. **Done when**: a strobe test file never makes the screen flash more than 3 times a second.

## Styles

Each style: bands (31 / 62 / 120), smoothing (attack / release), peak hold, colours, mirror, reflection where it fits.

### LED spectrum (realistic)

- **Sees**: a hi-fi analyser: bars made of LED segments, lit segments brighter, peak segment held 0.5 s then falling
  with gravity (accelerating), a glossy reflection, a faint frequency scale (50, 100, 500, 1k, 5k, 10k) and dB grid on
  hover.
- **How**: Canvas 2D, segments drawn as rounded rects cached in an offscreen sprite per colour.
- **Effort**: S. **Done when**: matches a reference look from the Figma file.

### Smooth curve, stereo overlay

- **Sees**: the spectrum as a filled curve with a soft glow; left and right as two translucent colours overlapping
  (mid where they agree).
- **How**: Catmull-Rom through band tops (like `wavePath` in `bars.ts`, generalised), `globalCompositeOperation =
  'lighter'` for the overlap.
- **Effort**: S.

### Radial around the cover

- **Sees**: Now Playing's cover in a circle of bars; the cover scales 2-4 % on kicks; bars mirrored to be symmetric.
- **How**: polar transform; the cover is the DOM image (the canvas sits behind with a hole).
- **Effort**: S-M.

### Analogue VU meters

- **Sees**: two needle meters (L / R) on a cream or dark dial with a red zone, real ballistics: VU (300 ms
  integration, slight overshoot) or PPM (fast attack, slow return), a peak LED holding 1 s.
- **How**: needle as a damped spring (mass-spring model tuned to the VU standard: 99 % in 300 ms, 1-1.5 % overshoot),
  dial drawn once to a cached bitmap. Skins: Classic, Modern (flat), the theme's colours.
- **Effort**: M (the ballistics right). **Done when**: step test: a 0 VU tone reaches 99 % in 300 ± 10 ms.

### Loudness meter

- **Sees**: three bars (momentary, short-term, integrated for this song) in LUFS, true peak in dBTP, the song's
  loudness range; the streaming target line (-14 LUFS) marked.
- **Effort**: S.

### Oscilloscope

- **Sees**: the waveform standing still (triggered on rising zero crossings of the low band), green phosphor with
  afterglow, or the theme's colour.
- **How**: afterglow = drawing over the previous frame with a translucent fill; trigger search in the 1024-sample
  block.
- **Effort**: S.

### Vectorscope / goniometer

- **Sees**: left vs right as a cloud (mono = a vertical line, wide stereo = a ball), a correlation meter (-1 to +1)
  under it.
- **How**: points (L-R, L+R) rotated 45°, additive blending, fade per frame; correlation = Σ L·R / √(Σ L² Σ R²).
- **Effort**: S.

### Spectrogram

- **Sees**: a scrolling waterfall (time left to right or bottom to top), log frequency axis, colour maps (Magma,
  Viridis, Inferno, the theme), a cursor showing frequency and note name on hover.
- **How**: WebGL2: one texture row per frame (ring buffer texture), colour map as a 1D texture; 120 bands or the raw
  bins for more detail (1024 log-spaced columns).
- **Effort**: M.

### 3D spectrum terrain

- **Sees**: the last ~5 s of spectrum as a landscape flying towards the camera, lit, with fog; slow orbit; beat bumps
  the camera.
- **How**: WebGL2 height-map mesh (120 × 128 grid), vertex shader reads the ring texture.
- **Effort**: M.

### Particles on the beat

- **Sees**: soft particles from the cover's colours bursting on kicks, drifting with the mids, over the blurred cover
  (Plexamp-like).
- **How**: GPU particles (transform feedback or a texture-based simulation), counts capped (2 000).
- **Effort**: M.

### Song waveform on the progress bar

Detailed in [catch-up.md](catch-up.md) › Squiggly / waveform progress bar (local files only).

### Preset engine

- **Sees**: a Presets look: community-made visuals (MilkDrop-style warping, feedback trails, shapes), shared as small
  files like themes, a few built in; a randomiser changing preset every N seconds or on drops.
- **How**: our own engine, written from scratch: a per-frame expression language (variables: bass, mid, treb, beat,
  time; outputs: zoom, rotation, warp, colours, shapes) compiled to a WebGL feedback loop (render to texture, warp,
  decay, draw shapes and waves on top). JSON preset format, versioned. A `.milk` reader only if the expression syntax
  maps cleanly (it's text; the format is open, the presets are their authors': user-provided files only, none
  shipped).
- **Rules**: no code from projectM / Butterchurn (licences differ; CLAUDE.md's "written from scratch" spirit).
  Expressions sandboxed (our own parser, no `eval`).
- **Effort**: L. **Risk**: scope (start with 10 built-in presets and the JSON format).
- **Done when**: 10 presets at 60 fps on the bench PC, a preset file imported from Add-ons.

### Visualizer API for plugins

- **Sees**: plugins can add looks.
- **How**: `crates/plugins` gets a `visualizer` permission; the plugin receives frames (bands, beat, loudness, not raw
  samples beyond the decimated scope block) and returns a list of 2D draw commands per frame (rects, paths, text,
  gradients) drawn by the app. API additions within `manifest::API` rules. Doc in `docs/plugins.md`, example plugin.
- **Rules**: never raw IPC or the canvas itself; time limit per frame (QuickJS budget), dropped frames when over.
- **Effort**: M. **Done when**: an example plugin draws a custom bar look; a slow plugin can't freeze the app.

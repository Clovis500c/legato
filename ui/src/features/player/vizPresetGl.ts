import { createFlashLimiter } from './flash'
import type { Border, PresetFrame } from './vizPreset'

/**
 * The Presets look's drawing (docs/playback.md › Presets): WebGL2 on its own OffscreenCanvas in the visualizer's
 * worker, copied onto the look's canvas by vizPaint.ts. Two pictures take turns: each frame the last one is drawn again
 * through the preset's mesh and faded, the borders and the wave go on top, then it is shown with the preset's gamma,
 * echo and effects, in the theme's ink (the picture's light as its opacity) or in its own colours (black see-through).
 * Its mean light goes through the flash limiter: past its budget the picture is dimmed or lifted to keep it.
 */
export interface PresetRenderer {
  /** One frame on a box of `w` × `h` pixels; the canvas to copy (smaller than the box: MAX_SIDE), or null once the GPU's context is gone. */
  draw(f: PresetFrame, wave: Float32Array, waveCount: number, w: number, h: number, ink: [number, number, number], own: boolean, calm: boolean): OffscreenCanvas | null
  dispose(): void
}

/** The picture's longer side at most, pixels: enough for a full screen once smoothed up, light for the GPU. */
const MAX_SIDE = 1024

const QUAD_VS = `#version 300 es
in vec2 at;
out vec2 vUv;
void main() { vUv = at * 0.5 + 0.5; gl_Position = vec4(at, 0.0, 1.0); }`

// The mesh: each point's place (the box's shares, y down) and where it takes its colour in the last picture.
const WARP_VS = `#version 300 es
in vec2 at;
in vec2 from;
out vec2 vFrom;
out vec2 vAt;
void main() {
  vFrom = vec2(from.x, 1.0 - from.y);
  vAt = at;
  gl_Position = vec4(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.0, 1.0);
}`
// floor8: an 8-bit picture keeps a faint trail forever (n × 0.98 rounds back to n); half a step less reaches black.
const WARP_FS = `#version 300 es
precision mediump float;
uniform sampler2D last;
uniform float fade;
uniform float floor8;
uniform float darkenCenter;
in vec2 vFrom;
in vec2 vAt;
out vec4 color;
void main() {
  vec3 c = texture(last, vFrom).rgb * fade - floor8;
  c *= 1.0 - darkenCenter * 0.08 * (1.0 - smoothstep(0.0, 0.2, distance(vAt, vec2(0.5))));
  color = vec4(max(c, 0.0), 1.0);
}`

const SOLID_VS = `#version 300 es
in vec2 at;
uniform vec2 shift;
uniform float size;
void main() {
  gl_Position = vec4(at.x * 2.0 - 1.0 + shift.x, 1.0 - at.y * 2.0 + shift.y, 0.0, 1.0);
  gl_PointSize = size;
}`
const SOLID_FS = `#version 300 es
precision mediump float;
uniform vec4 tint;
out vec4 color;
void main() { color = tint; }`

// effects: invert, brighten, darken, solarize (0 or 1 each).
const SHOW_FS = `#version 300 es
precision mediump float;
uniform sampler2D pic;
uniform float gain;
uniform float echoAlpha;
uniform float echoZoom;
uniform vec2 echoFlip;
uniform vec4 effects;
uniform vec3 ink;
uniform float own;
in vec2 vUv;
out vec4 color;
void main() {
  vec3 c = texture(pic, vUv).rgb;
  if (echoAlpha > 0.0) c = mix(c, texture(pic, (vUv - 0.5) * echoFlip / echoZoom + 0.5).rgb, echoAlpha);
  c = clamp(c * gain, 0.0, 1.0);
  c = mix(c, sqrt(c), effects.y);
  c = mix(c, c * c, effects.z);
  c = mix(c, c * (1.0 - c) * 4.0, effects.w);
  c = mix(c, 1.0 - c, effects.x);
  float a = max(c.r, max(c.g, c.b));
  color = own > 0.5 ? vec4(c, a) : vec4(ink * a, a);
}`

export function createPresetRenderer(): PresetRenderer | null {
  const canvas = new OffscreenCanvas(1, 1)
  let made: WebGL2RenderingContext | null = null
  try {
    made = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })
  } catch {
    made = null
  }
  if (!made) return null
  const gl = made

  function program(vs: string, fs: string): WebGLProgram {
    const p = gl.createProgram()
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)
      if (!s) throw new Error('no shader')
      gl.shaderSource(s, src)
      gl.compileShader(s)
      gl.attachShader(p, s)
      gl.deleteShader(s)
    }
    gl.bindAttribLocation(p, 0, 'at')
    gl.bindAttribLocation(p, 1, 'from')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    return p
  }
  let warp: WebGLProgram
  let solid: WebGLProgram
  let show: WebGLProgram
  try {
    warp = program(WARP_VS, WARP_FS)
    solid = program(SOLID_VS, SOLID_FS)
    show = program(QUAD_VS, SHOW_FS)
  } catch {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  const where = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]))
  const uw = where(warp, ['last', 'fade', 'floor8', 'darkenCenter'])
  const us = where(solid, ['shift', 'size', 'tint'])
  const ux = where(show, ['pic', 'gain', 'echoAlpha', 'echoZoom', 'echoFlip', 'effects', 'ink', 'own'])

  // The full box, for showing.
  const quad = gl.createVertexArray()
  gl.bindVertexArray(quad)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  // The mesh: places (made per size), sources (each frame), triangles.
  const mesh = gl.createVertexArray()
  const meshAt = gl.createBuffer()
  const meshFrom = gl.createBuffer()
  const meshIdx = gl.createBuffer()
  gl.bindVertexArray(mesh)
  gl.bindBuffer(gl.ARRAY_BUFFER, meshAt)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, meshFrom)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx)
  // The wave's and the borders' points.
  const lines = gl.createVertexArray()
  const linesBuf = gl.createBuffer()
  gl.bindVertexArray(lines)
  gl.bindBuffer(gl.ARRAY_BUFFER, linesBuf)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  const pics = [gl.createTexture(), gl.createTexture()]
  const fbos = [gl.createFramebuffer(), gl.createFramebuffer()]
  const probe = gl.createFramebuffer()
  const px = new Uint8Array(4)
  let picW = 0
  let picH = 0
  let cols = 0
  let rows = 0
  let indices = 0
  let turn = 0
  let limiter = createFlashLimiter(3)
  let calmNow = false
  const borders = new Float32Array(96)

  function size(w: number, h: number) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1))
    const pw = Math.max(1, Math.round(w * k))
    const ph = Math.max(1, Math.round(h * k))
    if (pw === picW && ph === picH) return
    picW = canvas.width = pw
    picH = canvas.height = ph
    // A new size starts from black.
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, pics[i])
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pw, ph, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i])
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pics[i], 0)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }

  function shape(c: number, r: number) {
    if (c === cols && r === rows) return
    cols = c
    rows = r
    const at = new Float32Array(2 * (c + 1) * (r + 1))
    for (let j = 0, n = 0; j <= r; j++)
      for (let i = 0; i <= c; i++, n++) {
        at[2 * n] = i / c
        at[2 * n + 1] = j / r
      }
    const idx = new Uint16Array(6 * c * r)
    for (let j = 0, n = 0; j < r; j++)
      for (let i = 0; i < c; i++) {
        const a = j * (c + 1) + i
        idx.set([a, a + 1, a + c + 1, a + 1, a + c + 2, a + c + 1], n)
        n += 6
      }
    indices = idx.length
    gl.bindVertexArray(mesh)
    gl.bindBuffer(gl.ARRAY_BUFFER, meshAt)
    gl.bufferData(gl.ARRAY_BUFFER, at, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
  }

  /** A frame of four strips, `t` thick (the shorter side's share), `inset` from the edges: triangles into `out` at `at`; returns the next place. */
  function frameOf(inset: number, t: number, out: Float32Array, at: number): number {
    const ex = Math.max(picW / picH, 1)
    const ey = Math.max(picH / picW, 1)
    const ix = inset / ex
    const iy = inset / ey
    const tx = t / ex
    const ty = t / ey
    const rects = [
      [ix, iy, 1 - ix, iy + ty],
      [ix, 1 - iy - ty, 1 - ix, 1 - iy],
      [ix, iy + ty, ix + tx, 1 - iy - ty],
      [1 - ix - tx, iy + ty, 1 - ix, 1 - iy - ty],
    ]
    for (const [x0, y0, x1, y1] of rects) {
      out.set([x0, y0, x1, y0, x0, y1, x1, y0, x1, y1, x0, y1], at)
      at += 12
    }
    return at
  }

  function tint(r: number, g: number, b: number, a: number) {
    gl.uniform4f(us.tint, r, g, b, a)
  }

  function drawBorder(b: Border, inset: number) {
    if (b.size <= 0 || b.a <= 0) return
    frameOf(inset, b.size, borders, 0)
    gl.bufferData(gl.ARRAY_BUFFER, borders.subarray(0, 48), gl.STREAM_DRAW)
    tint(b.r, b.g, b.b, b.a)
    gl.drawArrays(gl.TRIANGLES, 0, 24)
  }

  return {
    draw(f, wave, waveCount, w, h, ink, own, calm) {
      if (gl.isContextLost()) return null
      size(w, h)
      shape(f.cols, f.rows)
      if (calm !== calmNow) {
        calmNow = calm
        limiter = createFlashLimiter(calm ? 1 : 3)
      }
      const src = pics[turn]
      const dst = 1 - turn
      // The last picture again through the mesh, faded.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[dst])
      gl.viewport(0, 0, picW, picH)
      gl.disable(gl.BLEND)
      gl.colorMask(true, true, true, true)
      gl.useProgram(warp)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, src)
      const wrap = f.wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
      gl.uniform1i(uw.last, 0)
      gl.uniform1f(uw.fade, f.fade)
      gl.uniform1f(uw.floor8, f.fade < 1 ? 0.5 / 255 : 0)
      gl.uniform1f(uw.darkenCenter, f.darkenCenter ? 1 : 0)
      gl.bindVertexArray(mesh)
      gl.bindBuffer(gl.ARRAY_BUFFER, meshFrom)
      gl.bufferData(gl.ARRAY_BUFFER, f.uv, gl.STREAM_DRAW)
      gl.drawElements(gl.TRIANGLES, indices, gl.UNSIGNED_SHORT, 0)

      // Borders, then the wave, on top (the next frames carry them away).
      gl.useProgram(solid)
      gl.bindVertexArray(lines)
      gl.bindBuffer(gl.ARRAY_BUFFER, linesBuf)
      gl.enable(gl.BLEND)
      gl.colorMask(true, true, true, false)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform2f(us.shift, 0, 0)
      gl.uniform1f(us.size, 1)
      drawBorder(f.outer, 0)
      drawBorder(f.inner, f.outer.size)
      const wv = f.wave
      if (waveCount > 1 && wv.a > 0) {
        gl.bufferData(gl.ARRAY_BUFFER, wave.subarray(0, 2 * waveCount), gl.STREAM_DRAW)
        const top = Math.max(wv.r, wv.g, wv.b)
        const lift = wv.brighten && top > 0 ? 1 / top : 1
        tint(wv.r * lift, wv.g * lift, wv.b * lift, wv.a)
        if (wv.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
        const kind = wv.dots ? gl.POINTS : gl.LINE_STRIP
        gl.uniform1f(us.size, wv.thick ? 3 : 2)
        // Thick: the line again a pixel around.
        const shifts = wv.thick && !wv.dots ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]]
        for (const [sx, sy] of shifts) {
          gl.uniform2f(us.shift, (2 * sx) / picW, (2 * sy) / picH)
          gl.drawArrays(kind, 0, waveCount)
        }
      }
      gl.colorMask(true, true, true, true)
      gl.disable(gl.BLEND)

      // Its mean light, from the smallest of its mipmaps: the flash limiter's say on how it is shown.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindTexture(gl.TEXTURE_2D, pics[dst])
      gl.generateMipmap(gl.TEXTURE_2D)
      const top = Math.floor(Math.log2(Math.max(picW, picH)))
      gl.bindFramebuffer(gl.FRAMEBUFFER, probe)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pics[dst], top)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const light = Math.min(1, ((px[0] + px[1] + px[2]) / 765) * f.gamma)
      const allowed = limiter.step(light, performance.now() / 1000)
      const gain = light > 0.02 ? Math.min(4, Math.max(0.05, allowed / light)) : 1

      // Shown on the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, picW, picH)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(show)
      gl.bindTexture(gl.TEXTURE_2D, pics[dst])
      gl.uniform1i(ux.pic, 0)
      gl.uniform1f(ux.gain, f.gamma * gain)
      gl.uniform1f(ux.echoAlpha, f.echo.alpha)
      gl.uniform1f(ux.echoZoom, f.echo.zoom)
      gl.uniform2f(ux.echoFlip, f.echo.orient & 1 ? -1 : 1, f.echo.orient & 2 ? -1 : 1)
      gl.uniform4f(ux.effects, f.invert ? 1 : 0, f.brighten ? 1 : 0, f.darken ? 1 : 0, f.solarize ? 1 : 0)
      gl.uniform3f(ux.ink, ink[0], ink[1], ink[2])
      gl.uniform1f(ux.own, own ? 1 : 0)
      gl.bindVertexArray(quad)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindVertexArray(null)
      turn = dst
      return canvas
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

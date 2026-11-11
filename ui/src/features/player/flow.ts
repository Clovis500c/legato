// The flowing backdrop (Settings › Appearance › Flowing background): the blurred cover warped slowly by our own
// shader. Quarter size, 30 frames a second at most, drawn only while it moves (docs/notes/ideas/liner.md 12).

/** Canvas pixels for a box of w × h CSS px: a quarter each way (the picture is blurred, the browser stretches it). */
export const flowSize = (w: number, h: number): [number, number] => [Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4))]

/** At most 30 frames a second. */
export const FRAME_MS = 33
/** A new cover fades over the last one. */
export const FADE_MS = 1000

const VERT = 'attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'
// Two rounds of slow sine warp on the picture's coordinates, zoomed in so the warp never reaches past its edges.
const FRAG = `precision mediump float;
uniform sampler2D a, b;
uniform float fade, t;
varying vec2 uv;
void main() {
  vec2 q = uv;
  q += 0.08 * vec2(sin(q.y * 3.1 + t * 0.21), cos(q.x * 2.7 - t * 0.17));
  q += 0.06 * vec2(sin(q.y * 5.3 - t * 0.13 + 1.7), cos(q.x * 4.1 + t * 0.19 + 0.6));
  q = (q - 0.5) * 0.7 + 0.5;
  gl_FragColor = mix(texture2D(a, q), texture2D(b, q), fade);
}`

export interface Flow {
  /** A new picture: fades in over the one shown. */
  show(img: TexImageSource): void
  /** Moves while on; off, the picture holds still (a fade under way still ends). */
  run(on: boolean): void
  stop(): void
}

/** null: no WebGL here (the caller shows the still picture). */
export function startFlow(canvas: HTMLCanvasElement): Flow | null {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' })
  if (!gl) return null
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const at = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
  const texture = (unit: number) => {
    const tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3))
    return tex
  }
  // Two pictures, their roles swapped at each new one: `front` fades in over the other.
  const tex = [texture(0), texture(1)]
  let front = 0
  let shown = 0
  const uni = { a: gl.getUniformLocation(prog, 'a'), b: gl.getUniformLocation(prog, 'b'), fade: gl.getUniformLocation(prog, 'fade'), t: gl.getUniformLocation(prog, 't') }

  let on = false
  let frame = 0
  let last = 0
  // Seconds of motion so far: a pause doesn't jump the picture.
  let t = 0
  let fadeFrom = -FADE_MS
  const draw = (now: number) => {
    const [w, h] = flowSize(canvas.clientWidth, canvas.clientHeight)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
    gl.uniform1i(uni.a, 1 - front)
    gl.uniform1i(uni.b, front)
    gl.uniform1f(uni.fade, shown < 2 ? 1 : Math.min(1, (now - fadeFrom) / FADE_MS))
    gl.uniform1f(uni.t, t)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  const fading = (now: number) => now - fadeFrom < FADE_MS
  const tick = (now: number) => {
    frame = 0
    if (now - last >= FRAME_MS && !document.hidden) {
      if (on) t += Math.min(0.1, (now - last) / 1000)
      last = now
      draw(now)
    }
    if (on || fading(now)) frame = requestAnimationFrame(tick)
  }
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }
  return {
    show(img) {
      front = 1 - front
      gl.activeTexture(gl.TEXTURE0 + front)
      gl.bindTexture(gl.TEXTURE_2D, tex[front])
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
      shown++
      fadeFrom = performance.now()
      wake()
    },
    run(next) {
      on = next
      if (on) wake()
    },
    stop() {
      cancelAnimationFrame(frame)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

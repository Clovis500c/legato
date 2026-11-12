/** SVG path of dark modules ("0"/"1", row-major), one rect per horizontal run, offset by quiet zone. */
export function qrPath(size: number, modules: string, quiet: number): string {
  let d = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x] !== '1') continue
      let run = 1
      while (x + run < size && modules[y * size + x + run] === '1') run++
      d += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`
      x += run - 1
    }
  }
  return d
}

/** A QR code (size, row-major "0"/"1") on a white rounded square whose bottom right corner is at (right, bottom). */
export function drawCode(ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'beginPath' | 'roundRect' | 'fill' | 'fillRect'>, [n, bits]: [number, string], right: number, bottom: number, box = 190) {
  const quiet = 3
  const cell = Math.floor(box / (n + 2 * quiet))
  const side = cell * (n + 2 * quiet)
  const left = right - side
  const top = bottom - side
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.roundRect(left, top, side, side, 14)
  ctx.fill()
  ctx.fillStyle = '#000'
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') ctx.fillRect(left + (quiet + (i % n)) * cell, top + (quiet + Math.floor(i / n)) * cell, cell, cell)
}

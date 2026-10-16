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

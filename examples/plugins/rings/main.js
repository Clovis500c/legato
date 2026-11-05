// Rings: a look for the visualizer. Rings swell with the low notes and flash on the beat; the 31 bands stand along
// the bottom. Positions are shares of the box (0..1), a circle's radius a share of its shorter side.
let flash = 0

app.visualizer.register({ name: 'Rings' })

app.on('visualizer', (f) => {
  flash = f.beat ? 1 : flash * 0.8
  const low = (f.bands[3] + f.bands[4] + f.bands[5]) / 3
  const shapes = []
  for (let i = 0; i < 4; i++) {
    shapes.push({ op: 'circle', x: 0.5, y: 0.42, r: 0.1 + i * 0.07 + low * 0.1, width: 1.5 + flash * 2.5, alpha: (1 - i * 0.22) * (0.5 + flash / 2) })
  }
  const n = f.bands.length
  for (let i = 0; i < n; i++) {
    const h = f.bands[i] * 0.22
    shapes.push({ op: 'rect', x: i / n + 0.002, y: 1 - h, w: 1 / n - 0.004, h, alpha: 0.55 })
  }
  app.visualizer.draw(shapes)
})

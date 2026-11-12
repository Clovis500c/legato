import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { KEEP, trimWeights } from '../../../vite.phosphor'

const defs = fileURLToPath(new URL('../../../node_modules/@phosphor-icons/react/dist/defs/', import.meta.url))
const weightsOf = (code: string) => [...code.matchAll(/\n {2}\[\n {4}"(\w+)",/g)].map((m) => m[1])

it('keeps the weights the app draws in every icon and drops the others', () => {
  const files = readdirSync(defs).filter((f) => f.endsWith('.es.js'))
  expect(files.length).toBeGreaterThan(1000)
  for (const f of ['Star.es.js', 'Gear.es.js', files[0], files[files.length - 1]]) {
    const code = readFileSync(defs + f, 'utf8')
    const out = trimWeights(code)
    expect(weightsOf(out).sort(), f).toEqual([...KEEP].sort())
    // Still one expression: the same Map call, the kept paths untouched.
    expect(out).toContain('new Map([')
    expect(out.trimEnd().endsWith('export { l as default };') || out.includes('export')).toBe(true)
  }
})

it('is never asked for a weight it dropped', () => {
  const asked: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = dir + e.name
      if (e.isDirectory()) walk(p + '/')
      else if (/\.tsx$/.test(e.name)) for (const m of readFileSync(p, 'utf8').matchAll(/weight=(?:"(\w+)"|\{([^}]*)\})/g)) asked.push(...(m[1] ? [m[1]] : [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])))
    }
  }
  walk(fileURLToPath(new URL('../', import.meta.url)))
  expect(asked.length).toBeGreaterThan(50)
  // Strings of a condition (`page === 'addons'`) are not weights: only the names Phosphor knows count.
  expect(asked.filter((w) => /^(thin|light|regular|bold|fill|duotone)$/.test(w) && !KEEP.includes(w))).toEqual([])
})

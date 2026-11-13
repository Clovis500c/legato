import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isRtl } from './i18n'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// The player's own controls (and the visualizers) keep their physical sides, as media controls do in every language.
const KEPT = [join(ROOT, 'features', 'player'), join(ROOT, 'features', 'viz')]

function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return KEPT.includes(path) ? [] : tsx(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

// A physical side in a class name: ml- mr- pl- pr- left- right- text-left text-right rounded-l rounded-r border-l border-r.
const PHYSICAL = /(?<![\w/.-])(?:[a-z0-9[\]=&>*()_-]+:)*-?(?:(?:ml|mr|pl|pr|left|right)-(?=[\d[]|px\b|auto\b|full\b)|text-(?:left|right)(?![\w-])|rounded-(?:tl|tr|bl|br|l|r)(?=[-\s"'`}\]]|$)|border-(?:l|r)(?=[-\s"'`}\]]|$))/g

describe('right-to-left layout', () => {
  it('only Arabic and Hebrew are written right to left', () => {
    expect(['ar', 'he'].every(isRtl)).toBe(true)
    expect(['en', 'fr', 'zh', 'ja'].some(isRtl)).toBe(false)
  })

  it('the shell and the shared components use logical sides, so `dir` mirrors them', () => {
    const found: string[] = []
    for (const file of tsx(ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(PHYSICAL)) {
            // Centered (left-1/2 pulled back by half its width): no side to mirror; start-1/2 would put it off center.
            if (m[0].endsWith('left-') && line.slice(m.index).startsWith(`${m[0]}1/2`) && line.includes('-translate-x-1/2')) continue
            found.push(`${file.slice(ROOT.length + 1)}:${i + 1} ${m[0]}`)
          }
        })
    }
    expect(found).toEqual([])
  })
})

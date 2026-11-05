import { describe, expect, it } from 'vitest'
import { BUDGET, launchFiles, verdict } from './budget.mjs'

describe('launch budget', () => {
  it('counts the page script and the chunks it preloads, once', () => {
    const html = `<script type="module" crossorigin src="/assets/index-a.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/core-b.js">
    <link rel="modulepreload" crossorigin href="/assets/core-b.js">
    <link rel="stylesheet" crossorigin href="/assets/index-c.css">
    <link rel="icon" href="/assets/odd.js">`
    expect(launchFiles(html)).toEqual(['assets/index-a.js', 'assets/core-b.js'])
  })

  it('fails over the line and says what to do', () => {
    expect(verdict({ files: 3, kB: 900, gzipKB: BUDGET.gzipKB }).ok).toBe(true)
    const over = verdict({ files: 3, kB: 900, gzipKB: BUDGET.gzipKB + 5 })
    expect(over.ok).toBe(false)
    expect(over.line).toContain('over by 5 kB')
  })
})

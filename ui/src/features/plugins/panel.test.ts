import { describe, expect, it } from 'vitest'
import { cleanCommand, cleanCss, cleanTree } from './panel'

describe('plugin panel', () => {
  it('keeps known parts, drops the rest, bounds values', () => {
    const tree = cleanTree([
      { type: 'heading', text: 'Sleep timer' },
      { type: 'slider', id: 'min', label: 'Minutes', min: 5, max: 120, value: 500 },
      { type: 'script', text: 'alert(1)' },
      { type: 'button', label: 'no id' },
      { type: 'row', children: [{ type: 'button', id: 'go', label: 'Start', primary: true }, 'junk'] },
      { type: 'tracks', ids: [1, 2.5, '3', 4] },
    ])
    expect(tree).toEqual([
      { type: 'heading', text: 'Sleep timer' },
      { type: 'slider', id: 'min', label: 'Minutes', min: 5, max: 120, step: 1, value: 120 },
      { type: 'row', children: [{ type: 'button', id: 'go', label: 'Start', primary: true }] },
      { type: 'tracks', ids: [1, 4] },
    ])
    expect(cleanTree('nope')).toEqual([])
    expect(cleanTree(Array.from({ length: 1000 }, () => ({ type: 'divider' }))).length).toBe(300)
    let deep: unknown = [{ type: 'divider' }]
    for (let i = 0; i < 20; i++) deep = [{ type: 'row', children: deep }]
    expect(JSON.stringify(cleanTree(deep))).not.toContain('divider')
  })

  it('commands need an id and a title', () => {
    expect(cleanCommand({ id: 'a', title: ' Hi ', where: ['track', 'evil'] })).toEqual({ id: 'a', title: 'Hi', where: ['track'] })
    expect(cleanCommand({ id: 'a' })).toBeNull()
    expect(cleanCommand({ id: 'a', title: 'x', where: [] })?.where).toEqual(['player'])
  })

  it('css loses links, imports and anything that leaves the style tag', () => {
    const css = cleanCss(`@import url(https://evil.example/x.css); body { background: url("https://evil.example/p?leak") } .a { background: url(data:image/png;base64,AA) } /* hi */ </style><script>x</script> .b{behavior:url(x.htc)}`)
    expect(css).not.toMatch(/evil|@import|<\/style|behavior/)
    expect(css).toContain('url(data:image/png;base64,AA)')
    expect(cleanCss(42)).toBe('')
  })
})

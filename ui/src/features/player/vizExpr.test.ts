import { describe, expect, it } from 'vitest'
import { compile, MAX_NODES } from './vizExpr'

/** Runs one source once; its variables by name. */
function run(src: string, builtins: string[] = []) {
  const p = compile([src], builtins)
  expect(p.errors[0]).toBeNull()
  p.runs[0]()
  return (name: string) => p.vars[p.slot(name)]
}

describe('preset equations', () => {
  it('binds like arithmetic: powers before signs, then products, then sums', () => {
    const v = run('a = 1 + 2 * 3; b = -2^2; c = 2^3^2; d = (1 + 2) * 3; e = 7 % 3; f = 1 / 0; g = 2 * -3')
    expect([v('a'), v('b'), v('c'), v('d'), v('e'), v('f'), v('g')]).toEqual([7, -4, 512, 9, 1, 0, -6])
  })

  it('compares and joins as 1 or 0, and `if` runs one side only', () => {
    const v = run('a = 2 > 1; b = 1 == 2; c = !0; d = 1 && 0; e = 0 || 3; f = if(1, 5, 6); g = if(0, 5, 6); if(1, x = 1, y = 1); h = 5 & 3; k = 5 | 3')
    expect([v('a'), v('b'), v('c'), v('d'), v('e'), v('f'), v('g'), v('x'), v('y'), v('h'), v('k')]).toEqual([1, 0, 1, 0, 1, 5, 6, 1, 0, 1, 7])
  })

  it('sets with every operator, a variable keeping its value between runs', () => {
    const v = run('a = 5; a += 2; a *= 3; a -= 1; a /= 4; a %= 3; b /= 0')
    expect(v('a')).toBe(2)
    expect(v('b')).toBe(0)
    const p = compile(['n = n + 1'], [])
    for (let i = 0; i < 3; i++) p.runs[0]()
    expect(p.vars[p.slot('n')]).toBe(3)
  })

  it("has MilkDrop's functions and constants", () => {
    const v = run('a = max(1, sqr(3)); b = above(2, 1) + below(2, 1) + equal(2, 2); c = atan2(0, -1); d = sqrt(-4); e = $PI; f = int(-2.7); g = sigmoid(0, 1); h = clamp(5, 0, 2); r = rand(4)')
    expect([v('a'), v('b'), v('c'), v('d'), v('e'), v('f'), v('g'), v('h')]).toEqual([9, 2, Math.PI, 2, Math.PI, -2, 0.5, 2])
    expect([0, 1, 2, 3]).toContain(v('r'))
  })

  it('reads names without case, the built-in ones first in their places', () => {
    const p = compile(['X = Zoom * 2; tmp = 1 + rand_preset.x'], ['zoom', 'x'])
    expect([p.slot('zoom'), p.slot('x'), p.slot('ZOOM')]).toEqual([0, 1, 0])
    expect(p.slot('tmp')).toBe(2)
    expect(p.slot('rand_preset.x')).toBe(3)
    expect(p.slot('nothing')).toBe(-1)
    p.vars[0] = 1.5
    p.runs[0]()
    expect(p.vars[1]).toBe(3)
  })

  it('stores 0 for what is not a finite number', () => {
    const v = run('a = 1e308 * 10; b = log(0); c = 0 ^ -1; d = sqrt(4) / (1 - 1)')
    expect([v('a'), v('b'), v('c'), v('d')]).toEqual([0, 0, 0, 0])
  })

  it('takes comments, and a new line for a semicolon', () => {
    const v = run('a = 1 // one\n/* two\nlines */ b = 2\nc = a +\n b')
    expect([v('a'), v('b'), v('c')]).toEqual([1, 2, 3])
  })

  it("says what's wrong and on which line, the source then doing nothing", () => {
    const p = compile(['a = 1', 'b = 2;\nc = ;', 'd = foo(1)', 'e = sin(1, 2)', '1 = 2', 'f = 1 g = 2', 'h = $tau', 'k = (1'], [])
    expect(p.errors[0]).toBeNull()
    expect(p.errors.slice(1)).toEqual(['line 2: unexpected ";"', 'line 1: unknown function foo', 'line 1: sin takes 1', 'line 1: only a name can be set', 'line 1: expected ;', 'line 1: unknown constant $tau', 'line 1: expected )'])
    for (const r of p.runs) r()
    expect(p.vars[p.slot('a')]).toBe(1)
    expect(p.slot('b')).toBe(-1)
  })

  it('refuses a program too long or too deep, without running out of stack', () => {
    const long = compile([`a = ${'1 + '.repeat(MAX_NODES)}1`], [])
    expect(long.errors[0]).toBe('line 1: too long')
    const deep = compile([`a = ${'('.repeat(500)}1${')'.repeat(500)}`, `b = ${'-'.repeat(500)}1`], [])
    expect(deep.errors).toEqual(['line 1: nested too deeply', 'line 1: nested too deeply'])
  })

  it('counts nodes, folding what never changes', () => {
    const p = compile(['a = 2 * 3 + b', 'c = sin(0) + 1'], [])
    expect(p.sizes).toEqual([7, 6])
    p.runs[1]()
    expect(p.vars[p.slot('c')]).toBe(1)
  })
})

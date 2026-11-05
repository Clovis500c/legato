/**
 * The presets' equations (docs/playback.md › Presets), a small language of our own in MilkDrop's spirit, pure.
 * Statements end with `;` or a new line; `=` `+=` `-=` `*=` `/=` `%=` set a variable (names are case-blind, 0 until set,
 * kept between runs). Numbers only: `+ - * / %`, `^` power, comparisons and `&& || !` give 1 or 0, `& |` work on whole
 * numbers; `FUNCS`, `if(c, a, b)`, `$pi $e $phi`, line and block comments. No loops, strings or calls out: a program
 * reads and writes its preset's numbers, in a time its size bounds. Compiled to closures, never eval (the CSP has no
 * unsafe-eval). A division by 0 gives 0; a value that isn't finite is stored as 0.
 */

/** A program's longest source (characters) and most nodes; deeper nesting than MAX_DEPTH is refused. */
export const MAX_SOURCE = 32_768
export const MAX_NODES = 4000
const MAX_DEPTH = 64

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'set'; name: string; op: string; e: Node }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }

type Tok = { k: 'num'; v: number; line: number } | { k: 'name' | 'op'; v: string; line: number }

const CONSTS = new Map([['$pi', Math.PI], ['$e', Math.E], ['$phi', (1 + Math.sqrt(5)) / 2]])
// Longest first: `+=` before `+`.
const OPS = ['+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '=', '!', '&', '|', '(', ')', ',', ';']
const SETS = new Set(['=', '+=', '-=', '*=', '/=', '%='])
/** Binary operators by how tight they bind (`^` and the signs are apart: `-2^2` is -4, `2^3^2` is 512). */
const BINDS = new Map([['||', 1], ['&&', 2], ['|', 3], ['&', 4], ['==', 5], ['!=', 5], ['<', 6], ['>', 6], ['<=', 6], ['>=', 6], ['+', 7], ['-', 7], ['*', 8], ['/', 8], ['%', 8]])
const NUM = /(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy
// Dots inside names too: MilkDrop 2's `rand_preset.x` reads as a variable.
const NAME = /[a-z_][a-z0-9_.]*/iy
const CONST = /\$[a-z]+/iy

/** True as MilkDrop's equations read it: further from 0 than 0.00001. */
const yes = (x: number) => x > 1e-5 || x < -1e-5
const fin = (x: number) => (Number.isFinite(x) ? x : 0)
/** Whole parts, 0 for a modulo by 0. */
const mod = (a: number, b: number) => {
  const d = Math.trunc(b)
  return d === 0 ? 0 : Math.trunc(a) % d
}

type F = (...a: number[]) => number
/** Functions: how many arguments, what they give. `rand(n)`: a whole number under n (n ≥ 1), else under n. */
const FUNCS = new Map<string, [number, F]>([
  ['sin', [1, Math.sin]],
  ['cos', [1, Math.cos]],
  ['tan', [1, Math.tan]],
  ['asin', [1, Math.asin]],
  ['acos', [1, Math.acos]],
  ['atan', [1, Math.atan]],
  ['atan2', [2, Math.atan2]],
  ['sqrt', [1, (a) => Math.sqrt(Math.abs(a))]],
  ['sqr', [1, (a) => a * a]],
  ['abs', [1, Math.abs]],
  ['sign', [1, Math.sign]],
  ['min', [2, Math.min]],
  ['max', [2, Math.max]],
  ['pow', [2, Math.pow]],
  ['exp', [1, Math.exp]],
  ['log', [1, Math.log]],
  ['log10', [1, Math.log10]],
  ['floor', [1, Math.floor]],
  ['ceil', [1, Math.ceil]],
  ['int', [1, Math.trunc]],
  ['above', [2, (a, b) => (a > b ? 1 : 0)]],
  ['below', [2, (a, b) => (a < b ? 1 : 0)]],
  ['equal', [2, (a, b) => (a === b ? 1 : 0)]],
  ['band', [2, (a, b) => (yes(a) && yes(b) ? 1 : 0)]],
  ['bor', [2, (a, b) => (yes(a) || yes(b) ? 1 : 0)]],
  ['bnot', [1, (a) => (yes(a) ? 0 : 1)]],
  ['sigmoid', [2, (a, b) => 1 / (1 + Math.exp(-a * b))]],
  ['clamp', [3, (a, lo, hi) => Math.min(hi, Math.max(lo, a))]],
  ['rand', [1, (a) => (a >= 1 ? Math.floor(Math.random() * Math.floor(a)) : Math.random() * a)]],
])

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let line = 1
  let i = 0
  const lines = (from: number, to: number) => {
    for (let j = from; j < to; j++) if (src[j] === '\n') line++
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i)
      i = end < 0 ? src.length : end
      continue
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      lines(i, stop)
      i = stop
      continue
    }
    NUM.lastIndex = NAME.lastIndex = CONST.lastIndex = i
    const num = NUM.exec(src)
    if (num) {
      toks.push({ k: 'num', v: Number(num[0]), line })
      i += num[0].length
      continue
    }
    const name = NAME.exec(src)
    if (name) {
      toks.push({ k: 'name', v: name[0].toLowerCase(), line })
      i += name[0].length
      continue
    }
    const named = CONST.exec(src)
    if (named) {
      const v = CONSTS.get(named[0].toLowerCase())
      if (v === undefined) throw new Error(`line ${line}: unknown constant ${named[0]}`)
      toks.push({ k: 'num', v, line })
      i += named[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new Error(`line ${line}: unexpected "${c}"`)
    toks.push({ k: 'op', v: op, line })
    i += op.length
  }
  return toks
}

/** The statements of a source, and how many nodes they make. Throws "line N: what" on an error. */
function parse(src: string): { stmts: Node[]; nodes: number } {
  if (src.length > MAX_SOURCE) throw new Error('line 1: too long')
  const toks = lex(src)
  let i = 0
  let nodes = 0
  let depth = 0
  const fail = (what: string): never => {
    throw new Error(`line ${toks[Math.min(i, toks.length - 1)]?.line ?? 1}: ${what}`)
  }
  const make = <T extends Node>(n: T): T => (++nodes > MAX_NODES ? fail('too long') : n)
  const at = (v: string) => {
    const t = toks[i]
    return t !== undefined && t.k === 'op' && t.v === v
  }
  const deeper = () => {
    if (++depth > MAX_DEPTH) fail('nested too deeply')
  }

  function expr(): Node {
    deeper()
    const left = binary(1)
    const t = toks[i]
    let out = left
    if (t?.k === 'op' && SETS.has(t.v)) {
      if (left.t !== 'var') fail('only a name can be set')
      i++
      out = make({ t: 'set', name: (left as { name: string }).name, op: t.v, e: expr() })
    }
    depth--
    return out
  }
  function binary(min: number): Node {
    let a = unary()
    for (;;) {
      const t = toks[i]
      if (t?.k !== 'op') return a
      const bind = BINDS.get(t.v)
      if (bind === undefined || bind < min) return a
      i++
      a = make({ t: 'bin', op: t.v, a, b: binary(bind + 1) })
    }
  }
  function unary(): Node {
    const t = toks[i]
    if (t?.k !== 'op' || (t.v !== '-' && t.v !== '+' && t.v !== '!')) return power()
    i++
    deeper()
    const a = unary()
    depth--
    return t.v === '+' ? a : make({ t: 'un', op: t.v, a })
  }
  function power(): Node {
    const base = primary()
    if (!at('^')) return base
    i++
    deeper()
    const e = unary()
    depth--
    return make({ t: 'bin', op: '^', a: base, b: e })
  }
  function primary(): Node {
    const t = toks[i]
    if (!t) return fail('unexpected end')
    if (t.k === 'num') {
      i++
      return make({ t: 'num', v: t.v })
    }
    if (t.k === 'name') {
      i++
      if (!at('(')) return make({ t: 'var', name: t.v })
      i++
      const args: Node[] = []
      if (!at(')'))
        for (;;) {
          args.push(expr())
          if (!at(',')) break
          i++
        }
      if (!at(')')) fail('expected )')
      i++
      const want = t.v === 'if' ? 3 : FUNCS.get(t.v)?.[0]
      if (want === undefined) fail(`unknown function ${t.v}`)
      if (args.length !== want) fail(`${t.v} takes ${want}`)
      return make({ t: 'call', name: t.v, args })
    }
    if (t.v === '(') {
      i++
      const e = expr()
      if (!at(')')) fail('expected )')
      i++
      return e
    }
    return fail(`unexpected "${t.v}"`)
  }

  const stmts: Node[] = []
  while (i < toks.length) {
    if (at(';')) {
      i++
      continue
    }
    stmts.push(expr())
    if (i >= toks.length) break
    if (at(';')) i++
    else if (toks[i].line === toks[i - 1].line) fail('expected ;')
  }
  return { stmts, nodes }
}

type Fn = () => number
/** Closures that give the same number every time: a node made only of them is folded into one. */
const fixed = new WeakSet<Fn>()
const konst = (v: number): Fn => {
  const f = () => v
  fixed.add(f)
  return f
}

function opFn(op: string, a: Fn, b: Fn): Fn {
  switch (op) {
    case '+':
      return () => a() + b()
    case '-':
      return () => a() - b()
    case '*':
      return () => a() * b()
    case '/':
      return () => {
        const x = a()
        const d = b()
        return d === 0 ? 0 : x / d
      }
    case '%':
      return () => mod(a(), b())
    case '^':
      return () => Math.pow(a(), b())
    case '==':
      return () => (a() === b() ? 1 : 0)
    case '!=':
      return () => (a() !== b() ? 1 : 0)
    case '<':
      return () => (a() < b() ? 1 : 0)
    case '>':
      return () => (a() > b() ? 1 : 0)
    case '<=':
      return () => (a() <= b() ? 1 : 0)
    case '>=':
      return () => (a() >= b() ? 1 : 0)
    case '&&':
      return () => (yes(a()) && yes(b()) ? 1 : 0)
    case '||':
      return () => (yes(a()) || yes(b()) ? 1 : 0)
    case '&':
      return () => (a() | 0) & (b() | 0)
    default:
      return () => (a() | 0) | (b() | 0)
  }
}

function gen(n: Node, vars: Float64Array, at: (name: string) => number): Fn {
  const g = (m: Node) => gen(m, vars, at)
  switch (n.t) {
    case 'num':
      return konst(n.v)
    case 'var': {
      const k = at(n.name)
      return () => vars[k]
    }
    case 'set': {
      const k = at(n.name)
      const e = g(n.e)
      switch (n.op) {
        case '+=':
          return () => (vars[k] = fin(vars[k] + e()))
        case '-=':
          return () => (vars[k] = fin(vars[k] - e()))
        case '*=':
          return () => (vars[k] = fin(vars[k] * e()))
        case '/=':
          return () => {
            const d = e()
            return (vars[k] = d === 0 ? 0 : fin(vars[k] / d))
          }
        case '%=':
          return () => (vars[k] = mod(vars[k], e()))
        default:
          return () => (vars[k] = fin(e()))
      }
    }
    case 'un': {
      const a = g(n.a)
      const f: Fn = n.op === '!' ? () => (yes(a()) ? 0 : 1) : () => -a()
      return fixed.has(a) ? konst(f()) : f
    }
    case 'bin': {
      const a = g(n.a)
      const b = g(n.b)
      const f = opFn(n.op, a, b)
      return fixed.has(a) && fixed.has(b) ? konst(f()) : f
    }
    case 'call': {
      const args = n.args.map(g)
      const [a, b, c] = args
      if (n.name === 'if') {
        if (fixed.has(a)) return yes(a()) ? b : c
        return () => (yes(a()) ? b() : c())
      }
      const fn = (FUNCS.get(n.name) as [number, F])[1]
      const f: Fn = args.length === 1 ? () => fn(a()) : args.length === 2 ? () => fn(a(), b()) : () => fn(a(), b(), c())
      return n.name !== 'rand' && args.every((x) => fixed.has(x)) ? konst(f()) : f
    }
  }
}

export interface Programs {
  /** Every variable's value: the built-in names first, in their order, then the programs' own. */
  vars: Float64Array
  /** A variable's place in `vars`, -1 when neither a built-in nor any program has it. */
  slot: (name: string) => number
  /** One per source, in order: runs it on `vars` (does nothing for a source with an error). */
  runs: (() => void)[]
  /** One per source: what's wrong with it ("line 3: unknown function foo"), or null. */
  errors: (string | null)[]
  /** One per source: its size in nodes (0 with an error), what one run costs. */
  sizes: number[]
}

/** Sources that share their variables (a preset's once, every frame, every point), with the engine's names first. */
export function compile(sources: readonly string[], builtins: readonly string[]): Programs {
  const names = new Map<string, number>()
  const add = (name: string) => {
    if (!names.has(name)) names.set(name, names.size)
  }
  for (const n of builtins) add(n.toLowerCase())
  const parsed = sources.map((src) => {
    try {
      return { ...parse(src), error: null }
    } catch (e) {
      return { stmts: [], nodes: 0, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // Every name first, so the array has its final size before closures hold it.
  const visit = (n: Node): void => {
    if (n.t === 'var' || n.t === 'set') add(n.name)
    if (n.t === 'set') visit(n.e)
    else if (n.t === 'un') visit(n.a)
    else if (n.t === 'bin') {
      visit(n.a)
      visit(n.b)
    } else if (n.t === 'call') n.args.forEach(visit)
  }
  for (const p of parsed) p.stmts.forEach(visit)
  const vars = new Float64Array(names.size)
  const at = (name: string) => names.get(name) ?? 0
  const runs = parsed.map((p) => {
    // A statement that only gives a number does nothing: dropped.
    const fns = p.stmts.map((s) => gen(s, vars, at)).filter((f) => !fixed.has(f))
    return () => {
      for (let j = 0; j < fns.length; j++) fns[j]()
    }
  })
  return {
    vars,
    slot: (name) => names.get(name.toLowerCase()) ?? -1,
    runs,
    errors: parsed.map((p) => p.error),
    sizes: parsed.map((p) => p.nodes),
  }
}

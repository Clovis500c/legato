import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The pieces of the list that starts at `from` (just after its opening bracket) up to its closing `close`, split on `sep` outside any bracket, quote or generic. */
function topLevel(text: string, from: number, sep: string, close: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = from
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      // A lifetime ('_ in State<'_, X>) is not a string: it has no closing quote close by.
    } else if (c === '"' || c === '`' || (c === "'" && text[i + 1] !== '_' && /^'[^'\n]{0,80}'/.test(text.slice(i, i + 82)))) quote = c
    else if ('([{<'.includes(c) && !(c === '<' && text[i - 1] === ' ')) depth++
    else if (')]}>'.includes(c) && !(c === '>' && text[i - 1] === '=')) {
      if (depth === 0 && c === close) {
        out.push(text.slice(start, i))
        break
      }
      depth--
    } else if (c === sep && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  return out.filter((x) => x.trim())
}

describe('api types', () => {
  const src = readFileSync(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8')

  it('are written from Rust (pnpm types), none by hand', () => {
    // `Service` is the one front-end subset of a generated type.
    expect(src.match(/^export (?:interface|type) \w+/gm)).toEqual(['export type Service'])
    expect(src).toContain("export * from './generated'")
  })

  it('call commands the shell has, by their names', () => {
    // The wrappers are written by hand: a typo in a name would only show when the command is used.
    const shell = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)), 'utf8')
    const list = /generate_handler!\[([^\]]+(?:\][^\]]+)*?)\]\)/.exec(shell)?.[1] ?? ''
    const known = new Set(list.split(',').map((c) => c.replace(/#\[[^\]]*\]/, '').trim().split('::').pop()))
    const asked = [...src.matchAll(/\binvoke(?:<[^(]*>)?\(\s*'(\w+)'/g)].map((m) => m[1])
    expect(known.size).toBeGreaterThan(200)
    // Every call read: none in a form this test can't see.
    expect(asked.length).toBe(src.match(/\binvoke[<(]/g)?.length)
    expect(asked.filter((name) => !known.has(name))).toEqual([])
  })

  it('name every result and payload instead of spelling a struct out', () => {
    expect(src.match(/(?:invoke|listen)<\{/g)).toBeNull()
  })

  it('pass the arguments a command takes, by their names', () => {
    // Tauri maps `snake_case` Rust parameters to `camelCase` keys; a wrong or missing key only fails when the command runs.
    const dir = fileURLToPath(new URL('../../../src-tauri/src/', import.meta.url))
    const rust = readdirSync(dir).filter((f) => f.endsWith('.rs')).map((f) => readFileSync(dir + f, 'utf8')).join(String.fromCharCode(10))
    const injected = /^(?:State|AppHandle|Window|WebviewWindow|Webview|tauri::)/
    const camel = (n: string) => n.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())
    const takes = new Map<string, { all: Set<string>; need: Set<string> }>()
    for (const m of rust.matchAll(/#\[tauri::command[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\(/g)) {
      const args = { all: new Set<string>(), need: new Set<string>() }
      for (const part of topLevel(rust, m.index + m[0].length, ',', ')')) {
        const [name, type] = [part.slice(0, part.indexOf(':')).trim().replace(/^mut\s+/, ''), part.slice(part.indexOf(':') + 1).trim()]
        if (!name || injected.test(type)) continue
        args.all.add(camel(name))
        if (!type.startsWith('Option<')) args.need.add(camel(name))
      }
      takes.set(m[1], args)
    }
    expect(takes.size).toBeGreaterThan(200)
    const wrong: string[] = []
    for (const m of src.matchAll(/invoke(?:<[^(]*>)?\(\s*'(\w+)'\s*(,\s*\{)?/g)) {
      const want = takes.get(m[1])
      if (!want) continue
      const given = new Set(m[2] ? topLevel(src, m.index + m[0].length, ',', '}').map((k) => /^\w+/.exec(k.trim())?.[0] ?? '?') : [])
      for (const k of given) if (!want.all.has(k)) wrong.push(`${m[1]}: no argument "${k}"`)
      for (const k of want.need) if (!given.has(k)) wrong.push(`${m[1]}: "${k}" not passed`)
    }
    expect(wrong).toEqual([])
  })
})

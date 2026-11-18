import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Typed `invoke` wrappers, checked against the Rust side: every `invoke('<cmd>', { … })` in `shared/api.ts` names a command that is registered
 * in `generate_handler!` and passes the keys its parameters take (camelCase here, snake_case there; `State`, `AppHandle` and the windows are
 * the shell's own, never passed). Names and keys only, not types (those come from ts-rs).
 */
const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const rust = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? rust(join(dir, e.name)) : e.name.endsWith('.rs') ? [join(dir, e.name)] : []))
const files = rust(join(ROOT, 'src-tauri/src'))
const src = files.map((f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).join('\n')

/** Rust's `//` comments dropped (caveman ones carry colons and commas); a string's `://`, `///` or `"//` is left alone. */
const uncomment = (text: string) => text.replace(/(?<![:/"])\/\/[^\n]*/g, '')

/** The top-level pieces of `text` split at `sep`, brackets of every kind respected. */
function parts(text: string, strings = false): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  let str = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (str) {
      if (c.charCodeAt(0) === 92) i++
      else if (c === str) str = ''
    } else if (strings && (c === "'" || c === '"' || c === '`')) str = c
    else if ('([{<'.includes(c) && !(c === '<' && text[i - 1] === ' ')) depth++
    else if (')]}>'.includes(c) && !(c === '>' && text[i - 1] === '=')) depth--
    else if (c === ',' && depth === 0) {
      out.push(text.slice(from, i))
      from = i + 1
    }
  }
  out.push(text.slice(from))
  return out.map((p) => p.trim()).filter(Boolean)
}

/** Command → its parameters `{ name, optional }` as Tauri sees them from JS (shell-injected ones left out). */
function commands(text = src) {
  text = uncomment(text)
  const map = new Map<string, { name: string; optional: boolean }[]>()
  for (const m of text.matchAll(/#\[tauri::command[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([a-z]+\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\(/g)) {
    let i = m.index! + m[0].length
    let depth = 1
    const start = i
    for (; i < text.length && depth; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
    }
    const list = parts(text.slice(start, i - 1)).flatMap((p) => {
      const at = p.indexOf(':')
      if (at < 0) return []
      const type = p.slice(at + 1).trim()
      if (/^(?:tauri::)?(?:State|AppHandle|Window|WebviewWindow|WebviewWindow<[^>]*>)\b/.test(type) || /\b(?:State|AppHandle|Window|WebviewWindow)</.test(type) || /^(?:tauri::)?(?:AppHandle|Window|WebviewWindow)\b/.test(type)) return []
      const name = p.slice(0, at).trim().replace(/^mut\s+/, '')
      return [{ name: name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), optional: /^Option\s*</.test(type) }]
    })
    map.set(m[1], list)
  }
  return map
}

/** The names `generate_handler!` registers: the last segment of each path. */
function registered(text = src): Set<string> {
  const block = /generate_handler!\[([\s\S]*?)\]\)/.exec(uncomment(text))![1]
  return new Set(parts(block).map((p) => p.replace(/#\[[^\]]*\]/g, '').trim().split('::').at(-1)!))
}

/** Every `invoke('<cmd>', { keys })` in api.ts: the command and the keys of its argument object (null: no object). */
function calls() {
  const text = readFileSync(join(ROOT, 'ui/src/shared/api.ts'), 'utf8').replace(/\r\n/g, '\n')
  const out: { cmd: string; keys: string[] | null }[] = []
  for (const m of text.matchAll(/\binvoke\b(?:<[^(]*?>)?\(\s*'(\w+)'\s*([,)])/g)) {
    if (m[2] === ')') {
      out.push({ cmd: m[1], keys: null })
      continue
    }
    const rest = text.slice(m.index! + m[0].length).trimStart()
    if (!rest.startsWith('{')) {
      out.push({ cmd: m[1], keys: [] })
      continue
    }
    let depth = 0
    let end = 0
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth++
      else if (rest[end] === '}' && --depth === 0) break
    }
    const keys = parts(rest.slice(1, end), true).map((p) => /^[\w$]+/.exec(p.replace(/^\.\.\./, ''))?.[0] ?? p)
    out.push({ cmd: m[1], keys })
  }
  return out
}

describe('the typed invoke wrappers match the Rust commands', () => {
  const cmds = commands()
  const reg = registered()
  const found = calls()

  it('reads a believable number of both sides', () => {
    expect(cmds.size).toBeGreaterThan(200)
    expect(reg.size).toBeGreaterThan(200)
    expect(found.length).toBeGreaterThan(200)
  })

  it('reads known commands the way Tauri names their arguments', () => {
    expect(cmds.get('ytm_artist')!.map((p) => p.name)).toEqual(['name', 'titles', 'video'])
    expect(cmds.get('ytm_artist')!.map((p) => p.optional)).toEqual([false, true, true])
    expect(cmds.get('server_scrobble')!.map((p) => p.name)).toContain('startedAtMs')
    expect(found.find((c) => c.cmd === 'connect')!.keys).toEqual(['source', 'credentials'])
    expect(found.find((c) => c.cmd === 'sources_status')!.keys).toBeNull()
  })

  it('a comment in a parameter list or in the handler list is not read as code', () => {
    const rs = [
      '#[tauri::command]',
      'async fn demo(',
      '    // Feb 2026: own playlists only, never theirs.',
      '    id: i64, // the row: from `playlists`',
      "    state: State<'_, App>,",
      ') {}',
      'fn run() { b.invoke_handler(tauri::generate_handler![',
      '    // Phone only: a, b',
      '    demo,',
      ']); }',
    ].join('\n')
    expect(commands(rs).get('demo')).toEqual([{ name: 'id', optional: false }])
    expect([...registered(rs)]).toEqual(['demo'])
  })

  it('every command api.ts calls is registered and exists', () => {
    const unknown = [...new Set(found.map((c) => c.cmd))].filter((c) => !reg.has(c) || !cmds.has(c))
    expect(unknown).toEqual([])
  })

  it('every call passes only the keys its command takes, and every required one', () => {
    const bad: string[] = []
    for (const { cmd, keys } of found) {
      const params = cmds.get(cmd)
      if (!params || !keys) {
        if (params && !keys && params.some((p) => !p.optional)) bad.push(`${cmd}: no arguments, needs ${params.filter((p) => !p.optional).map((p) => p.name)}`)
        continue
      }
      const known = new Set(params.map((p) => p.name))
      for (const k of keys) if (!known.has(k)) bad.push(`${cmd}: unknown key "${k}" (takes ${[...known].join(', ') || 'none'})`)
      for (const p of params) if (!p.optional && !keys.includes(p.name)) bad.push(`${cmd}: missing "${p.name}"`)
    }
    expect(bad).toEqual([])
  })

  it('every registered command is one the shell defines', () => {
    expect([...reg].filter((r) => !cmds.has(r))).toEqual([])
  })
})

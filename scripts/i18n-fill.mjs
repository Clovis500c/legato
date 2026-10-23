// Builds ui/src/shared/i18n/locales/<code>.ts from translations keyed by fr.ts line numbers.
// Usage: node scripts/i18n-fill.mjs <code> <Name> <lines.txt>...   (each line: "<fr.ts line>|<translation>")
// Keys and comments come from fr.ts as written, so a key can't be mistyped; missing lines are listed and fail.
// A new locale file unseen by the tests? Vitest caches import.meta.glob: delete node_modules/.vitest-cache.
import { readFileSync, writeFileSync } from 'node:fs'

const [code, name, ...inputs] = process.argv.slice(2)
if (!code || !name || !inputs.length) {
  console.error('Usage: node scripts/i18n-fill.mjs <code> <Name> <lines.txt>...')
  process.exit(1)
}
const dir = new URL('../ui/src/shared/i18n/locales/', import.meta.url)
const fr = readFileSync(new URL('fr.ts', dir), 'utf8').split(/\r?\n/)

const given = new Map()
for (const file of inputs)
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^(\d+)\|(.*)$/.exec(line)
    if (m) given.set(Number(m[1]), m[2])
  }

const ENTRY = /^(\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\w+):\s/
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const out = [`/** ${name}. Keys: the English text exactly as written in the code (tr / trn / msg). Built from fr.ts lines by scripts/i18n-fill.mjs. */`, `const ${code}: Record<string, string> = {`]
const missing = []
const used = new Set()
fr.forEach((line, i) => {
  const n = i + 1
  if (/^\s*\/\//.test(line)) return out.push(line)
  const m = ENTRY.exec(line)
  if (!m || n <= 2) return
  if (!given.has(n)) return missing.push(n)
  used.add(n)
  out.push(`${m[1]}${m[2]}: ${quote(given.get(n))},`)
})
out.push('}', '', `export default ${code}`, '')
const extra = [...given.keys()].filter((n) => !used.has(n))
if (missing.length || extra.length) {
  console.error(`Missing lines: ${missing.join(', ') || 'none'}\nLines that aren't entries: ${extra.join(', ') || 'none'}`)
  process.exit(1)
}
writeFileSync(new URL(`${code}.ts`, dir), out.join('\n'))
console.log(`${code}.ts: ${used.size} texts`)

// Front-end budget (docs/performance.md, Results): the JS a launch loads, the page's script and the chunks it
// preloads (dist/index.html), stays under its line. Run by CI after `vite build`: a large regression fails the check.
// A page or a dialog made lazy lowers it; raise BUDGET only on purpose, in the same commit as what needs it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/** JS at launch in kB, gzip (steadier than raw against the minifier's noise). 2026-11-05: 307 kB, so about 10 % room. */
export const BUDGET = { gzipKB: 340 }

/** The page's own scripts and the chunks it preloads, in order, once. */
export function launchFiles(html) {
  const files = []
  for (const m of html.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*\brel="modulepreload"[^>]*\bhref)="\/?([^"]+\.js)"/g)) {
    if (!files.includes(m[1])) files.push(m[1])
  }
  return files
}

/** Sizes in kB (1000 bytes, as Vite prints them). */
export function measure(dist) {
  const files = launchFiles(readFileSync(join(dist, 'index.html'), 'utf8'))
  let raw = 0
  let gzip = 0
  for (const f of files) {
    const bytes = readFileSync(join(dist, f))
    raw += bytes.length
    gzip += gzipSync(bytes, { level: 9 }).length
  }
  return { files: files.length, kB: Math.round(raw / 1000), gzipKB: Math.round(gzip / 1000) }
}

/** The verdict line, and whether it passes. */
export function verdict(m, budget = BUDGET) {
  const ok = m.gzipKB <= budget.gzipKB
  const line = `JS at launch: ${m.kB} kB (${m.gzipKB} kB gzip) in ${m.files} files; budget ${budget.gzipKB} kB gzip`
  return { ok, line: ok ? line : `${line}: over by ${m.gzipKB - budget.gzipKB} kB. Make something lazy (ui/src/app/pages.ts), or raise BUDGET in scripts/budget.mjs on purpose.` }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  const { ok, line } = verdict(measure(dist))
  console.log(line)
  if (!ok) process.exit(1)
}

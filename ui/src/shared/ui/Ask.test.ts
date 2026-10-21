import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

// Under Tauri's dialog plugin window.confirm returns a Promise (always truthy): `if (!confirm(…))` never stops.
it('never uses the browser’s confirm, prompt or alert (shared/ui/Ask instead)', () => {
  const bad = sources(ROOT).filter((file) => /(?<![\w.])(?:window\.)?(?:confirm|prompt|alert)\(/.test(readFileSync(file, 'utf8')))
  expect(bad).toEqual([])
})

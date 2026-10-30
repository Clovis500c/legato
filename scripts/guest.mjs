// What a guest build of the app needs to be driven from a script (`pnpm bench`, `pnpm e2e`): a build under its own
// identifier, started with WebView2's DevTools port open (scripts/cdp.mjs). Pure helpers, shared so both scripts read the
// same flags and make the same checks.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const ROOT_INPUTS = new Set(['Cargo.toml', 'Cargo.lock', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json'])

/** Files whose content decides what the build makes (git paths). Docs, tests, examples and scripts do not. */
export function isBuildInput(file) {
  if (/(^|\/)examples\//.test(file) || /\.md$/.test(file) || /\.test\.tsx?$/.test(file)) return false
  return ROOT_INPUTS.has(file) || /^(src-tauri|crates|ui)\//.test(file)
}

/** Hash of every build input in the working tree (tracked, or new and not ignored): same hash, same build. */
export function inputsHash(root) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter((f) => f && isBuildInput(f))
    .sort()
  const hash = createHash('sha256')
  for (const f of files) {
    if (!existsSync(path.join(root, f))) continue
    hash.update(`${f}\0`)
    hash.update(readFileSync(path.join(root, f)))
  }
  return hash.digest('hex')
}

/** The identifier is baked into the exe: a build made for another one must not start here. */
export function carriesId(bytes, id) {
  return bytes.includes(Buffer.from(id))
}

/** Reads background::BROWSER_ARGS: every webview of the app must carry the same flags. */
export function browserArgs(rustSource) {
  const found = /pub const BROWSER_ARGS: &str = "([^"]*)";/.exec(rustSource)
  if (!found) throw new Error('background.rs: BROWSER_ARGS not found')
  return found[1]
}

/** A port nothing listens on (asked from the system, then released). */
export const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

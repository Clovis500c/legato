// The loopback server that stands in for the network during the smoke test. The e2e build (src-tauri/src/hosts.rs, cargo
// feature `e2e`) sends the calls of search, suggestions, lyrics and the Apple lookups here, one path per service:
//   POST /youtube/search     normal YouTube (InnerTube)       e2e/fixtures/youtube-search.json
//   POST /ytmusic/search     YouTube Music, signed out        e2e/fixtures/ytmusic-search.json
//   GET  /itunes/search      Apple's catalog                  e2e/fixtures/itunes-search.json
//   GET  /itunes/lookup      Apple's lookup                   no result
//   GET  /suggest            YouTube's search suggestions     built from the typed text
//   GET  /lrclib/...         lyrics                           not found
// Paths /deezer, /deezer-link and /applepage (pasted Deezer / Apple Music links) are not answered: the test pastes none.
// The fixtures hold the shapes the parsers read (crates/connectors), trimmed, with invented names. Anything else is a
// 404 and is listed in `unexpected()`: a new call the app makes shows up in the test.

import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')

/** What each route answers: the fixture, or a function of the request's query. */
const ROUTES = {
  'POST /youtube/search': () => fixture('youtube-search.json'),
  'POST /ytmusic/search': () => fixture('ytmusic-search.json'),
  'GET /itunes/search': () => fixture('itunes-search.json'),
  'GET /itunes/lookup': () => JSON.stringify({ resultCount: 0, results: [] }),
  'GET /suggest': (query) => {
    const q = query.get('q') ?? ''
    return JSON.stringify([q, [q, `${q} glass harbour`, `${q} lyrics`], [], { 'google:suggestsubtypes': [] }])
  },
}

/** The answer to one request: { status, body }. `query` = URLSearchParams. */
export function answer(method, pathname, query) {
  const route = ROUTES[`${method} ${pathname}`]
  if (route) return { status: 200, body: route(query) }
  // LRCLIB says "not found" with a 404 and this body.
  if (method === 'GET' && pathname.startsWith('/lrclib/')) return { status: 404, body: JSON.stringify({ statusCode: 404, name: 'NotFound', message: 'Failed to find specified track' }) }
  return { status: 404, body: JSON.stringify({ error: `the smoke test's mock has no ${method} ${pathname}` }) }
}

/** Is this one of the calls the mock knows? */
export function known(method, pathname) {
  return `${method} ${pathname}` in ROUTES || (method === 'GET' && pathname.startsWith('/lrclib/'))
}

/** Starts the server on a free loopback port. `requests` lists what it got, in order: { method, path, query, body }. */
export async function startMock() {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const text = Buffer.concat(chunks).toString('utf8')
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      requests.push({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body })
      const { status, body: out } = answer(req.method ?? 'GET', url.pathname, url.searchParams)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(out)
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    /** The requests to one route, e.g. `to('POST', '/youtube/search')`. */
    to: (method, pathname) => requests.filter((r) => r.method === method && r.path === pathname),
    /** Requests the mock has no route for (lyrics excepted). */
    unexpected: () => requests.filter((r) => !known(r.method, r.path)),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

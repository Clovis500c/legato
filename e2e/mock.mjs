// The loopback server that stands in for the network during the smoke test. The e2e build (src-tauri/src/hosts.rs, cargo
// feature `e2e`) sends the calls of search, suggestions, lyrics and the Apple lookups here, one path per service:
//   POST /youtube/search     normal YouTube (InnerTube)       e2e/fixtures/youtube-search.json
//   POST /ytmusic/search     YouTube Music, signed out        e2e/fixtures/ytmusic-search.json
//   GET  /itunes/search      Apple's catalog                  e2e/fixtures/itunes-search.json
//   GET  /itunes/lookup      Apple's lookup                   the album of a pasted Apple link, else no result
//   GET  /suggest            YouTube's search suggestions     built from the typed text
//   GET  /lrclib/...         lyrics                           not found
//   GET  /sponsorblock/...   non-music parts (off by default)  none
//   GET  /deezer/playlist/<id>[/tracks]  a pasted Deezer playlist   e2e/fixtures/deezer-playlist*.json
// The song searches answer by the typed text. One song of the pasted Deezer playlist and one of the pasted Apple album
// have a YouTube version (a second late, so the walk sees the import's progress toast), the other of each has none: "1 of 2
// found". Any other text gets the default results. Paths /deezer-link and /applepage (short links, Apple playlists) are
// not answered: the test pastes none.
// The fixtures hold the shapes the parsers read (crates/connectors), trimmed, with invented names. Anything else is a
// 404 and is listed in `unexpected()`: a new call the app makes shows up in the test.

import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')

/** The pasted links the walk uses. */
export const DEEZER_LINK = 'https://www.deezer.com/playlist/2477790684'
export const APPLE_LINK = 'https://music.apple.com/us/album/in-between-dreams-bonus-track-version/1440857781'

/** Songs of those lists that exist on YouTube: [what the typed text holds, uploader, title, length]. */
const ON_YOUTUBE = [
  ["can't hold us", 'Macklemore', "Can't Hold Us (feat. Ray Dalton)", '4:18'],
  ['better together', 'Jack Johnson', 'Better Together', '3:28'],
]
/** Songs of those lists that do not: the search finds nothing. */
const NOWHERE = ['i follow rivers', 'never know']
/** How late the import's songs are found. */
const LATE = 1500

/** The results for a typed text (a video id is 11 characters): the fixture's, or the one song the lists above name, or none. */
function youtubeFor(body) {
  const typed = String(body?.query ?? '').toLowerCase()
  const page = JSON.parse(fixture('youtube-search.json'))
  const list = page.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer
  const hit = ON_YOUTUBE.find(([key]) => typed.includes(key))
  if (hit) {
    const [, who, title, length] = hit
    list.contents = [{ videoRenderer: { videoId: `e2eSong${String(ON_YOUTUBE.indexOf(hit)).padStart(4, '0')}`, title: { runs: [{ text: `${who} - ${title}` }] }, ownerText: { runs: [{ text: who }] }, lengthText: { simpleText: length }, ownerBadges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED_ARTIST' } }] } }]
  } else if (NOWHERE.some((key) => typed.includes(key))) list.contents = []
  else return { body: JSON.stringify(page) }
  return { body: JSON.stringify(page), delay: LATE }
}

/** YouTube Music finds nothing for the list songs; its fixture answers the rest. */
const ytmusicFor = (body) => {
  const typed = String(body?.query ?? '').toLowerCase()
  return [...ON_YOUTUBE.map(([key]) => key), ...NOWHERE].some((key) => typed.includes(key)) ? { body: '{}' } : { body: fixture('ytmusic-search.json') }
}

/** What each route answers: { body, delay? } from a function of the request's query and JSON body, or the body alone. */
const ROUTES = {
  'POST /youtube/search': (_query, body) => youtubeFor(body),
  'POST /ytmusic/search': (_query, body) => ytmusicFor(body),
  'GET /itunes/search': () => fixture('itunes-search.json'),
  'GET /itunes/lookup': (query) => (query.get('id') === '1440857781' ? fixture('itunes-lookup-album.json') : JSON.stringify({ resultCount: 0, results: [] })),
  'GET /deezer/playlist/2477790684': () => fixture('deezer-playlist.json'),
  'GET /deezer/playlist/2477790684/tracks': (query) => (query.get('index') === '0' ? fixture('deezer-playlist-tracks.json') : JSON.stringify({ data: [], total: 153 })),
  'GET /suggest': (query) => {
    const q = query.get('q') ?? ''
    return JSON.stringify([q, [q, `${q} glass harbour`, `${q} lyrics`], [], { 'google:suggestsubtypes': [] }])
  },
}

/** The answer to one request: { status, body, delay }. `query` = URLSearchParams, `body` = the parsed JSON sent, if any;
 *  `delay` = ms to wait before answering. */
export function answer(method, pathname, query, body = null) {
  const route = ROUTES[`${method} ${pathname}`]
  if (route) {
    const out = route(query, body)
    return typeof out === 'string' ? { status: 200, body: out, delay: 0 } : { status: 200, delay: 0, ...out }
  }
  // LRCLIB says "not found" with a 404 and this body.
  if (method === 'GET' && pathname.startsWith('/sponsorblock/')) return { status: 404, delay: 0, body: 'Not Found' }
  if (method === 'GET' && pathname.startsWith('/lrclib/')) return { status: 404, delay: 0, body: JSON.stringify({ statusCode: 404, name: 'NotFound', message: 'Failed to find specified track' }) }
  return { status: 404, delay: 0, body: JSON.stringify({ error: `the smoke test's mock has no ${method} ${pathname}` }) }
}

/** Is this one of the calls the mock knows? */
export function known(method, pathname) {
  return `${method} ${pathname}` in ROUTES || (method === 'GET' && (pathname.startsWith('/lrclib/') || pathname.startsWith('/sponsorblock/')))
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
      const { status, body: out, delay } = answer(req.method ?? 'GET', url.pathname, url.searchParams, body)
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(out)
      }, delay)
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

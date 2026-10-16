import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const src = readFileSync(new URL('./youtube.js', import.meta.url), 'utf8')
const g = globalThis as Record<string, unknown>

/** Run script as if loaded in a frame of `hostname`; returns undo. */
function inject(hostname: string) {
  const saved = { parse: JSON.parse, json: Response.prototype.json }
  g.location = { hostname }
  g.window = globalThis
  new Function(src)()
  return () => {
    JSON.parse = saved.parse
    Response.prototype.json = saved.json
    delete g.ytInitialPlayerResponse
    delete g.location
    delete g.window
  }
}

it('prunes ad slots from YouTube player data', async () => {
  const undo = inject('www.youtube.com')
  try {
    expect(JSON.parse('{"adPlacements":[1],"videoDetails":{"videoId":"x"}}')).toEqual({ videoDetails: { videoId: 'x' } })
    expect(JSON.parse('{"playerResponse":{"playerAds":[1],"streamingData":{}}}')).toEqual({ playerResponse: { streamingData: {} } })
    expect(await new Response('{"adSlots":[1],"ok":1}').json()).toEqual({ ok: 1 })
    g.ytInitialPlayerResponse = { adPlacements: [1], a: 1 }
    expect(g.ytInitialPlayerResponse).toEqual({ a: 1 })
    expect(JSON.parse('[1,2]')).toEqual([1, 2])
  } finally {
    undo()
  }
})

it('leaves other sites alone', () => {
  const undo = inject('tauri.localhost')
  try {
    expect(JSON.parse('{"adSlots":1}')).toEqual({ adSlots: 1 })
  } finally {
    undo()
  }
})

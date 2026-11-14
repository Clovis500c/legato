import { describe, expect, it, vi } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import { sanitize } from '../../shared/theme/theme'
import { usePlayer } from './store'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn(async () => undefined) }))

const song = (id: number): LibraryTrack => ({ id, added: 0, addedAt: null, title: `Song ${id}`, artist: `Artist ${id}`, album: null, durationMs: null, isrc: null, ids: { youtube: `video${id}` } })
const more = [song(902), song(903)]
vi.mock('./autoDj', () => ({ djMore: vi.fn(async () => false) }))
vi.mock('./radio', () => ({ similarForQueue: vi.fn(async () => more) }))

describe('what plays when Up next runs out has no switch any more', () => {
  it('a saved `autoplay: false` is ignored: the setting is gone, and songs still come at the end of the queue', async () => {
    const saved = sanitize({ autoplay: false, similarVariety: 'adventurous' }) as unknown as Record<string, unknown>
    expect('autoplay' in saved).toBe(false)
    expect(saved.similarVariety).toBe('adventurous')
    await import('./autoplay')
    usePlayer.setState({ repeat: 'off' })
    usePlayer.getState().playTracks([song(901)], 0)
    usePlayer.getState().step(1, true)
    await new Promise((r) => setTimeout(r))
    expect(usePlayer.getState().list.map((t) => t.id)).toEqual([901, 902, 903])
    expect(usePlayer.getState().now?.youtubeId).toBe('video902')
  })
})

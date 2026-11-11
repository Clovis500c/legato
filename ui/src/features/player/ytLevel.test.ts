import { describe, expect, it, vi } from 'vitest'

vi.mock(import('./live'), async (real) => ({ ...(await real()), setLevel: vi.fn() }))

const { levelDb, rememberLoudness, startLevelling } = await import('./ytLevel')
const { setLevel, useLive } = await import('./live')
const { usePlayer } = await import('./store')

describe('YouTube songs levelled', () => {
  it('raises a quiet video to -14 LUFS, never cuts, nothing when off or unmeasured', () => {
    expect(levelDb('quietvideo1', 'track')).toBe(0)
    rememberLoudness('quietvideo1', -20.04)
    expect(levelDb('quietvideo1', 'track')).toBe(6)
    expect(levelDb('quietvideo1', 'album')).toBe(6)
    expect(levelDb('quietvideo1', 'off')).toBe(0)
    rememberLoudness('loudvideo01', -8)
    expect(levelDb('loudvideo01', 'track')).toBe(0)
    rememberLoudness('silentvideo', -90)
    expect(levelDb('silentvideo', 'track')).toBe(0)
    rememberLoudness('verysoft001', -40)
    expect(levelDb('verysoft001', 'track')).toBe(9)
  })

  it('keeps what a video sounded like once heard 30 s, and sends its gain on the next play', () => {
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    const yt = (id: string) => ({ via: 'youtube', youtubeId: id, title: id, artist: '' }) as never
    usePlayer.setState({ now: yt('measured001'), playing: true })
    const stop = startLevelling(() => 'track')
    for (let i = 0; i < 400; i++) {
      t += 100
      useLive.setState({ levels: { fast: -22, momentary: -22, short: -22, peak: 0.1, gain: 0 } as never })
    }
    usePlayer.setState({ now: yt('other000001') })
    expect(levelDb('measured001', 'track')).toBe(8)
    // Heard under 30 s: not kept.
    for (let i = 0; i < 100; i++) {
      t += 100
      useLive.setState({ levels: { fast: -30, momentary: -30, short: -30, peak: 0.1, gain: 0 } as never })
    }
    usePlayer.setState({ now: yt('measured001') })
    expect(levelDb('other000001', 'track')).toBe(0)
    expect(setLevel).toHaveBeenLastCalledWith(8)
    stop()
  })
})

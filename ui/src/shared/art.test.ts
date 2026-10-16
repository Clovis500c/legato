import { describe, expect, it, vi } from 'vitest'
import { bigUrls, firstArt, isLetterboxed, trackArt } from './art'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string, scheme: string) => `http://${scheme}.localhost/${encodeURIComponent(p)}` }))

describe('trackArt', () => {
  it('prefers the local file cover, then stored art', () => {
    const t = { id: 7, ids: { local: 'C:/m/a.flac', youtube: 'v' }, art: 'https://i.ytimg.com/vi/v/hqdefault.jpg' }
    expect(trackArt(t)).toEqual(['http://art.localhost/local%2F7', 'http://art.localhost/https%3A%2F%2Fi.ytimg.com%2Fvi%2Fv%2Fhqdefault.jpg'])
    expect(trackArt({ ids: { local: 'x' } })).toEqual([])
    expect(firstArt([{ ids: {} }, { ids: {}, art: 'https://i.scdn.co/image/a' }])).toEqual(['http://art.localhost/https%3A%2F%2Fi.scdn.co%2Fimage%2Fa'])
  })

  it('asks each host for its biggest artwork, original kept last', () => {
    expect(bigUrls('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj')).toEqual(['https://lh3.googleusercontent.com/abc=w1200-h1200', 'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj'])
    expect(bigUrls('https://yt3.ggpht.com/abc=s88-c-k')[0]).toBe('https://yt3.ggpht.com/abc=s1200')
    expect(bigUrls('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')).toEqual(['https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'])
    expect(bigUrls('https://is1-ssl.mzstatic.com/image/thumb/a/600x600bb.jpg')[0]).toBe('https://is1-ssl.mzstatic.com/image/thumb/a/1200x1200bb.jpg')
    expect(bigUrls('https://i.scdn.co/image/ab67')).toEqual(['https://i.scdn.co/image/ab67'])
  })

  it('spots letterboxed YouTube frames only', () => {
    const [frame] = trackArt({ ids: {}, art: 'https://i.ytimg.com/vi/a-b_c/hqdefault.jpg' })
    const [wide] = trackArt({ ids: {}, art: 'https://i.ytimg.com/vi/abc/mqdefault.jpg' })
    const [cover] = trackArt({ ids: {}, art: 'https://lh3.googleusercontent.com/x=w544-h544' })
    expect([frame, wide, cover].map(isLetterboxed)).toEqual([true, false, false])
  })
})

import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../../shared/api'
import type { DiscordSettings } from '../../shared/theme/theme'
import type { NowPlaying } from '../player/store'
import { presenceFor, samePresence } from './presence'
import { ADDONS, allTags, DISCORD, filterAddons } from './registry'

const opts: DiscordSettings = { appId: '1', status: 'song', buttons: true, paused: false, github: false }
const now: NowPlaying = { title: 'jinx', artist: 'lexycat', via: 'youtube', youtubeId: 'abc', trackId: 1 }
const track = { id: 1, added: 1, title: 'jinx', artist: 'lexycat', album: 'Pink', durationMs: 197_000, isrc: null, ids: { youtube: 'abc' }, art: 'https://lh3.googleusercontent.com/x=w120-h120' } as LibraryTrack

describe('presenceFor', () => {
  it('song, cover, button to where it plays', () => {
    expect(presenceFor(now, track, true, 30_000.4, 197_000, opts)).toEqual({ title: 'jinx', artist: 'lexycat', album: 'Pink', art: track.art, buttons: [['Listen on YouTube', 'https://www.youtube.com/watch?v=abc']], playing: true, positionMs: 30_000, durationMs: 197_000, status: 'song' })
    const sp = presenceFor({ ...now, via: 'spotify', youtubeId: undefined, spotifyId: 'xyz' }, undefined, true, 0, null, opts)
    expect(sp?.buttons).toEqual([['Listen on Spotify', 'https://open.spotify.com/track/xyz']])
    expect(presenceFor(now, track, true, 0, null, { ...opts, github: true })?.buttons[1]).toEqual(['Get App On GitHub', 'https://github.com/Clovis500c/legato'])
    expect(sp?.art).toBeNull()
  })

  it('nothing when stopped or paused (unless asked), no button when off, no local cover', () => {
    expect(presenceFor(undefined, track, true, 0, null, opts)).toBeNull()
    expect(presenceFor(now, track, false, 0, null, opts)).toBeNull()
    expect(presenceFor(now, track, false, 0, null, { ...opts, paused: true })?.playing).toBe(false)
    expect(presenceFor(now, track, true, 0, null, { ...opts, buttons: false })?.buttons).toEqual([])
    const local = presenceFor({ ...now, via: 'local', youtubeId: undefined }, { ...track, art: null }, true, 0, null, opts)
    expect(local?.art).toBeNull()
    expect(local?.buttons).toEqual([])
  })
})

describe('samePresence', () => {
  const p = presenceFor(now, track, true, 10_000, 197_000, opts)
  it('playing on: same; seek or pause: send again', () => {
    expect(samePresence(p, 0, { ...p!, positionMs: 20_000 }, 10_000)).toBe(true)
    expect(samePresence(p, 0, { ...p!, positionMs: 60_000 }, 10_000)).toBe(false)
    expect(samePresence(p, 0, { ...p!, playing: false }, 0)).toBe(false)
    expect(samePresence(null, 0, null, 5)).toBe(true)
    expect(samePresence(p, 0, null, 0)).toBe(false)
  })
})

describe('filterAddons', () => {
  it('by text, state and tags', () => {
    expect(filterAddons(ADDONS, { query: 'discord' }).map((a) => a.id)).toEqual([DISCORD])
    expect(filterAddons(ADDONS, { query: 'nothing like it' })).toEqual([])
    expect(filterAddons(ADDONS, { show: 'enabled' })).toEqual([])
    expect(filterAddons(ADDONS, { show: 'enabled', on: { [DISCORD]: true } })).toHaveLength(1)
    expect(filterAddons(ADDONS, { show: 'disabled', on: { [DISCORD]: true } })).toEqual([])
    expect(filterAddons(ADDONS, { tags: ['Social'] })).toHaveLength(1)
    expect(filterAddons(ADDONS, { tags: ['Social', 'Nope'] })).toEqual([])
    expect(allTags(ADDONS)).toEqual(['Player', 'Social'])
  })
})

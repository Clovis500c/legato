import { describe, expect, it } from 'vitest'
import { mergedText } from './merged'

const none = { playlists: 0, deleted: 0, songs: 0, removed: 0, plays: 0, edits: 0, settings: 0 }

describe('sync summary', () => {
  it('says nothing when nothing came', () => {
    expect(mergedText(none)).toBeNull()
  })

  it('names what came, counts in words', () => {
    expect(mergedText({ ...none, playlists: 1, plays: 12, deleted: 1, removed: 2 })).toBe('From your other PC: 1 playlist, 3 deletions, 12 listens')
  })
})

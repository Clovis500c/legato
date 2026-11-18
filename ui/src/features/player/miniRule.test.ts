import { describe, expect, it } from 'vitest'
import { dockedOf, miniCard, panelCard } from './miniRule'

describe('where the mini player docks', () => {
  it('the right panel holds it only on a wide window: never on a narrow one, never on a phone (it has no right panel)', () => {
    expect(dockedOf('panel', false, false)).toBe(true)
    expect(dockedOf('panel', true, false)).toBe(false)
    expect(dockedOf('panel', false, true)).toBe(false)
    expect(dockedOf('float', false, false)).toBe(false)
  })
  it('so on a phone a YouTube video keeps its hidden slot (200 px, out of sight), mini player on or off', () => {
    for (const on of [true, false]) expect(miniCard({ video: true, on, phone: true, full: false, docked: dockedOf('panel', false, true) })).toBe('hidden')
  })
})

// The owner's choice of 2026-11-18: a YouTube video shows nowhere outside Now Playing unless the mini player is on.
describe('the floating mini player', () => {
  const base = { video: false, on: false, phone: false, full: false, docked: false }
  it('YouTube alone no longer brings a card: with the mini player off its video plays out of sight', () => {
    expect(miniCard({ ...base, video: true })).toBe('hidden')
    expect(miniCard({ ...base, video: true, on: true })).toBe('card')
  })
  it('another source: a card only with the mini player on', () => {
    expect(miniCard(base)).toBe('none')
    expect(miniCard({ ...base, on: true })).toBe('card')
  })
  it('the phone never shows a card, its video stays out of sight', () => {
    expect(miniCard({ ...base, video: true, on: true, phone: true })).toBe('hidden')
    expect(miniCard({ ...base, on: true, phone: true })).toBe('card')
  })
  it('Now Playing open, or the right panel holding it: nothing here', () => {
    expect(miniCard({ ...base, video: true, full: true })).toBe('none')
    expect(miniCard({ ...base, video: true, on: true, docked: true })).toBe('none')
  })
})

describe('the right panel’s mini player', () => {
  const base = { here: true, full: false, playing: true, video: false, on: false }
  it('shown while a song plays and the mini player is on, YouTube included', () => {
    expect(panelCard({ ...base, on: true })).toBe('stage')
    expect(panelCard({ ...base, video: true, on: true })).toBe('stage')
  })
  it('a YouTube video with the mini player off, or paused, is kept out of sight (never as a floating card)', () => {
    expect(panelCard({ ...base, video: true })).toBe('parked')
    expect(panelCard({ ...base, video: true, on: true, playing: false })).toBe('parked')
  })
  it('another source off or paused, Now Playing open, or the card elsewhere: nothing', () => {
    expect(panelCard(base)).toBe('none')
    expect(panelCard({ ...base, on: true, playing: false })).toBe('none')
    expect(panelCard({ ...base, video: true, on: true, full: true })).toBe('none')
    expect(panelCard({ ...base, video: true, on: true, here: false })).toBe('none')
  })
})

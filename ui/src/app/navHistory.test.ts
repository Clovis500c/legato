import { describe, expect, it } from 'vitest'
import { backStep, type BackState } from './backStep'
import { MAX_BACK, pushView, sameView, scrollKey } from './navHistory'
import { rememberScroll, restoreScroll } from './scrollMemory'
import { validBack } from './screen'
import type { View } from './store'

const A: View = { name: 'home' }
const B: View = { name: 'album', album: 'Low Tide Radio', artist: 'Halden Marsh' }
const C: View = { name: 'playlist', id: 7 }
const none: BackState = { menu: false, layer: false, viz: false, cover: false, karaoke: false, full: false, canBack: false }

/** The store's go / goBack over the pure pieces: what Android's Back walks. */
function walk() {
  let view: View = A
  let back: View[] = []
  return {
    go(v: View) {
      back = pushView(back, view, v)
      view = v
    },
    // Android's Back: a page while there is one, else nothing (the app goes behind).
    back(): View | null {
      if (backStep({ ...none, canBack: back.length > 0 }) !== 'page') return null
      view = back.at(-1)!
      back = back.slice(0, -1)
      return view
    },
  }
}

describe('the back stack a phone walks', () => {
  it('navigate A, B, C: Back gives B, then A, then leaves (nothing left)', () => {
    const w = walk()
    w.go(B)
    w.go(C)
    expect(w.back()).toEqual(B)
    expect(w.back()).toEqual(A)
    expect(w.back()).toBeNull()
  })

  it('opening the page you are on adds no entry (a settings highlight is the same page) (a tab tapped twice does not need two Backs)', () => {
    const w = walk()
    w.go(B)
    w.go({ ...B })
    w.go({ ...B })
    expect(w.back()).toEqual(A)
    expect(w.back()).toBeNull()
    expect(sameView(A, { name: 'home' })).toBe(true)
    expect(sameView({ name: 'settings', section: 'general' }, { name: 'settings', section: 'general', focus: 'Theme' })).toBe(true)
    expect(sameView(B, { ...B, artist: 'Other' })).toBe(false)
  })

  it('keeps the last MAX_BACK entries', () => {
    let back: View[] = []
    for (let i = 0; i < MAX_BACK + 20; i++) back = pushView(back, { name: 'playlist', id: i }, { name: 'playlist', id: i + 1 })
    expect(back).toHaveLength(MAX_BACK)
    expect(back.at(-1)).toEqual({ name: 'playlist', id: MAX_BACK + 19 })
  })
})

describe('the stack across a restart', () => {
  it('is read back, each page checked like a restored screen (a deleted playlist drops out), nothing odd survives', () => {
    const raw = [A, { name: 'playlist', id: 7 }, { name: 'playlist', id: 99 }, { name: 'evil' }, 'x', null, B]
    expect(validBack(raw, [7])).toEqual([A, { name: 'playlist', id: 7 }, B])
    expect(validBack('nope', [])).toEqual([])
    expect(validBack(Array.from({ length: 500 }, () => A), [])).toHaveLength(MAX_BACK)
  })
})

describe('scroll memory keys', () => {
  it('tell two pages apart and one page from itself', () => {
    expect(scrollKey(B)).toBe(scrollKey({ ...B }))
    expect(scrollKey(B)).not.toBe(scrollKey(C))
    expect(scrollKey({ name: 'settings', section: 'general', focus: 'x' })).toBe(scrollKey({ name: 'settings', section: 'general' }))
  })
})

describe('scroll memory without a page (tests, a window not drawn yet)', () => {
  it('does nothing and does not throw', () => {
    expect(() => (rememberScroll(A), restoreScroll(A))).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { backStep, type BackState } from './backStep'
import { closeTopLayer, hasLayer, holdLayer } from '../shared/ui/layers'

const none: BackState = { menu: false, layer: false, viz: false, cover: false, karaoke: false, full: false, canBack: false }

describe('backStep', () => {
  it('closes what is on top first, then goes back a page', () => {
    const all: BackState = { menu: true, layer: true, viz: true, cover: true, karaoke: true, full: true, canBack: true }
    expect(backStep(all)).toBe('menu')
    expect(backStep({ ...all, menu: false })).toBe('layer')
    expect(backStep({ ...all, menu: false, layer: false })).toBe('viz')
    expect(backStep({ ...none, cover: true, karaoke: true, full: true })).toBe('cover')
    expect(backStep({ ...none, karaoke: true, full: true, canBack: true })).toBe('karaoke')
    expect(backStep({ ...none, full: true, canBack: true })).toBe('full')
    expect(backStep({ ...none, canBack: true })).toBe('page')
  })

  it('has nothing left at the root: the app goes behind', () => {
    expect(backStep(none)).toBeNull()
  })
})

describe('layers', () => {
  it('closes the newest first, and a closed one leaves the stack', () => {
    const shut: string[] = []
    const leaveA = holdLayer(() => shut.push('a'))
    const leaveB = holdLayer(() => shut.push('b'))
    expect(hasLayer()).toBe(true)
    expect(closeTopLayer()).toBe(true)
    expect(shut).toEqual(['b'])
    leaveB()
    expect(closeTopLayer()).toBe(true)
    expect(shut).toEqual(['b', 'a'])
    leaveA()
    expect(hasLayer()).toBe(false)
    expect(closeTopLayer()).toBe(false)
  })

  it('leaving twice or out of order keeps the others', () => {
    const shut: string[] = []
    const leaveA = holdLayer(() => shut.push('a'))
    const leaveB = holdLayer(() => shut.push('b'))
    leaveA()
    leaveA()
    expect(closeTopLayer()).toBe(true)
    expect(shut).toEqual(['b'])
    leaveB()
    expect(hasLayer()).toBe(false)
  })
})

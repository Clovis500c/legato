import { describe, expect, it } from 'vitest'
import type { SyncDeviceRow } from '../../shared/api'
import { kindLabel, left, rowNote, typedCode } from './devicesView'

const row = (r: Partial<SyncDeviceRow>): SyncDeviceRow => ({ id: 'a'.repeat(32), name: 'Pixel', os: 'android', form: 'phone', trusted: true, here: true, offering: false, synced: null, refused: false, ...r })
const ago = (ms: number) => `${ms} ms ago`

describe('devices view', () => {
  it('names the kind, Apple phones by name', () => {
    expect(kindLabel('windows', 'tower')).toBe('Windows tower PC')
    expect(kindLabel('windows', 'laptop')).toBe('Windows laptop')
    expect(kindLabel('android', 'phone')).toBe('Android phone')
    expect(kindLabel('ios', 'phone')).toBe('iPhone')
    expect(kindLabel('ios', 'tablet')).toBe('iPad')
    expect(kindLabel('macos', 'desktop')).toBe('macOS desktop')
  })

  it('says here or not, and the last sync', () => {
    expect(rowNote(row({}), ago)).toBe('On this network')
    expect(rowNote(row({ synced: 5 }), ago)).toBe('On this network · synced 5 ms ago')
    expect(rowNote(row({ here: false, synced: 5 }), ago)).toBe('Not on this network · synced 5 ms ago')
    expect(rowNote(row({ here: false }), ago)).toBe('Not on this network')
    expect(rowNote(row({ refused: true, synced: 5 }), ago)).toBe('It forgot this device: pair again')
    expect(rowNote(row({ trusted: false }), ago)).toBe('Not paired')
    expect(rowNote(row({ trusted: false, offering: true }), ago)).toBe('Showing a code: pair it')
  })

  it('counts down in minutes and seconds', () => {
    expect(left(600_000, 0)).toBe('10:00')
    expect(left(545_100, 0)).toBe('9:06')
    expect(left(0, 5_000)).toBe('0:00')
  })

  it('takes 6 digits, spaced or not, or a pairing link', () => {
    expect(typedCode('042 917')).toEqual({ code: '042917', link: null })
    expect(typedCode('04291')).toBeNull()
    expect(typedCode(' legato://pair?c=042917&h=192.168.1.2:47822&i=x ')).toEqual({ code: '', link: 'legato://pair?c=042917&h=192.168.1.2:47822&i=x' })
  })
})

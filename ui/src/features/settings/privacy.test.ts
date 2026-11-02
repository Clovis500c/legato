import { describe, expect, it } from 'vitest'
import type { Contact } from '../../shared/api'
import { byVia, countText } from './privacy'

const contact = (host: string, via: Contact['via'], count: number): Contact => ({ host, via, why: 'other', count, blocked: 0, last: 0 })

describe('privacy page', () => {
  it('groups by who asked, most asked first', () => {
    const groups = byVia([contact('lrclib.net', 'app', 1), contact('googlevideo.com', 'window', 9), contact('music.youtube.com', 'app', 4), contact('a.com', 'app', 4)])
    expect(groups.map((g) => g.via)).toEqual(['app', 'window'])
    expect(groups[0].rows.map((c) => c.host)).toEqual(['a.com', 'music.youtube.com', 'lrclib.net'])
  })

  it('counts connections for the app, requests for pages', () => {
    expect(countText(contact('lrclib.net', 'app', 1))).toBe('1 connection')
    expect(countText(contact('googlevideo.com', 'window', 12))).toBe('12 requests')
  })
})

import { describe, expect, it } from 'vitest'
import { fromFragment, hueOf, summary } from './sharelink'

// Written by Rust (`share::tests::a_web_link_reads_like_the_app_link` prints it): both sides read the same bytes.
const LINK = '#eNpj4g3KT0xRKCnKLFB4NKOBhaWUx-Lw1QWxR7iDMpOzFRyLS3JSK8X9UstSixTc8_PyEhXcM8tSFSLzSxVCC64yMu3rW7KMiZk9uKQoPzcxlc8xJ7-oWCE_TyElMa84lbHnijiDvkeoDABd0yPS'

describe('a share link read in a browser', () => {
  it('reads what Rust wrote', async () => {
    expect(await fromFragment(LINK)).toEqual({
      name: 'Road trip ☀',
      items: [
        { kind: 'youtube', id: 'dQw4w9WgXcQ', artist: 'Rick Astley', title: 'Never Gonna Give You Up', secs: 213 },
        { kind: 'apple', id: '617154366' },
        { kind: 'text', artist: 'Stromae', title: 'Alors on danse' },
        { kind: 'youtube', id: 'jNQXAC9IVRw', artist: '', title: '', secs: 0 },
      ],
    })
  })

  it('refuses what is not a playlist', async () => {
    await expect(fromFragment('')).rejects.toThrow('holds no playlist')
    await expect(fromFragment('#<script>')).rejects.toThrow('holds no playlist')
    await expect(fromFragment('#AAAA')).rejects.toThrow('damaged')
    // A flipped character: zlib's checksum or the reader catches it.
    await expect(fromFragment(LINK.replace('KT0x', 'KT0y'))).rejects.toThrow('damaged')
    await expect(fromFragment(LINK.slice(0, 60))).rejects.toThrow('This link')
  })
})

describe('what the preview page shows', () => {
  it('sums a playlist from its link alone', () => {
    const list = { name: 'x', items: [{ kind: 'youtube' as const, id: 'a', artist: '', title: '', secs: 90 }, { kind: 'youtube' as const, id: 'b', artist: '', title: '', secs: 30 }, { kind: 'apple' as const, id: '1' }, { kind: 'text' as const, artist: 'A', title: 'B' }] }
    expect(summary(list)).toEqual({ songs: 4, minutes: 2, youtube: 2, apple: 1 })
  })

  it('gives a name its own steady colour', () => {
    expect(hueOf('Road trip')).toBe(hueOf('Road trip'))
    expect(hueOf('Road trip')).not.toBe(hueOf('Road trips'))
    for (const n of ['', 'é', '☀☀☀', 'x'.repeat(1000)]) expect([hueOf(n) >= 0, hueOf(n) < 360]).toEqual([true, true])
  })
})

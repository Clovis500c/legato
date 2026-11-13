import { expect, it } from 'vitest'
import { isShareCode } from './shareCode'

it('knows every shape of a shared playlist, not the other legato links', () => {
  for (const ok of ['https://clovis500c.github.io/legato/l/#eNpj', 'legato://playlist/eNpj', 'LG1:ABC']) expect(isShareCode(ok)).toBe(true)
  for (const no of ['musicapp://playlist/eNpj', 'MA1:ABC', 'legato://room?x', 'legato://pair?x', 'https://clovis500c.github.io/legato/', 'https://youtu.be/dQw4w9WgXcQ', '']) expect(isShareCode(no)).toBe(false)
})

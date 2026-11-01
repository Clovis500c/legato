import { describe, expect, it } from 'vitest'
import { matchCommands } from './commands'

const cmd = (label: string, words = '') => ({ label, words: `${label} ${words}` })
const COMMANDS = [
  cmd('Shuffle on / off'),
  cmd('Theme', 'dark light mode colors'),
  cmd('Stats', 'statistics listening history'),
  cmd('Start radio'),
  cmd('Fade between songs', 'crossfade transition fade out in'),
  cmd('Thème', 'Theme dark'),
  cmd('歌曲间淡入淡出', 'Fade between songs'),
]
const labels = (q: string, max?: number) => matchCommands(COMMANDS, q, max).map((c) => c.label)

describe('the search bar’s pages, actions and settings', () => {
  it('finds a label by the start of its words, and by its keywords', () => {
    expect(labels('shuf')).toEqual(['Shuffle on / off'])
    expect(labels('off shuffle')).toEqual(['Shuffle on / off'])
    expect(labels('dark')).toEqual(['Theme', 'Thème'])
    expect(labels('cross')).toEqual(['Fade between songs'])
  })

  it('puts the labels that start with what’s typed first, shorter first, then the rest', () => {
    expect(labels('st')).toEqual(['Stats', 'Start radio'])
    expect(labels('theme')).toEqual(['Theme', 'Thème'])
    expect(labels('fade')).toEqual(['Fade between songs', '歌曲间淡入淡出'])
  })

  it('reads accents, scripts without spaces, and stops at nothing or one letter', () => {
    expect(labels('THEME')).toEqual(['Theme', 'Thème'])
    expect(labels('淡入')).toEqual(['歌曲间淡入淡出'])
    expect(labels('s')).toEqual([])
    expect(labels('  ')).toEqual([])
    expect(labels('zz')).toEqual([])
    expect(labels('s', 1)).toEqual([])
  })
})

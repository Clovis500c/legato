import { describe, expect, it } from 'vitest'
import { pickableLines, wrapText } from './shareCard'

// 10 px a character.
const measure = (s: string) => [...s].length * 10

describe('share card text', () => {
  it('cuts by words', () => {
    expect(wrapText('Salt on the Dial', 80, 2, measure)).toEqual(['Salt on', 'the Dial'])
    expect(wrapText('Short', 80, 2, measure)).toEqual(['Short'])
  })

  it('ends with an ellipsis when text is left', () => {
    expect(wrapText('one two three four five six', 80, 2, measure)).toEqual(['one two', 'three…'])
  })

  it('cuts text without spaces by characters', () => {
    expect(wrapText('夜に駆ける夜に駆ける', 50, 2, measure)).toEqual(['夜に駆ける', '夜に駆ける'])
    expect(wrapText('Supercalifragilistic', 80, 3, measure)).toEqual(['Supercal', 'ifragili', 'stic'])
  })

  it('offers lyric lines once, without blanks or notes', () => {
    expect(pickableLines([{ text: 'Hello' }, { text: '' }, { text: '♪' }, { text: 'Hello' }, { text: 'Again ' }], undefined)).toEqual(['Hello', 'Again'])
    expect(pickableLines(undefined, 'One\n\nTwo\n')).toEqual(['One', 'Two'])
    expect(pickableLines([], undefined)).toEqual([])
  })
})

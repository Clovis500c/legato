import { describe, expect, it } from 'vitest'
import { leaders, playerOf, scored, turnsOf } from './players'

describe('players taking turns on one device', () => {
  it('the rounds go round the players', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((r) => playerOf(r, 3))).toEqual([0, 1, 2, 0, 1, 2, 0])
    expect([0, 1, 2].map((r) => playerOf(r, 1))).toEqual([0, 0, 0])
    expect(playerOf(5, 0)).toBe(0)
  })
  it('a point goes to the player whose turn it was, none changes nothing; the list is not mutated', () => {
    const start = [0, 0, 0]
    const one = scored(start, 1, 1)
    expect(one).toEqual([0, 1, 0])
    expect(start).toEqual([0, 0, 0])
    expect(scored(one, 2, 0)).toEqual([0, 1, 0])
  })
  it("each player's score is out of their own turns", () => {
    expect([0, 1, 2].map((p) => turnsOf(p, 10, 3))).toEqual([4, 3, 3])
    expect([0, 1].map((p) => turnsOf(p, 10, 2))).toEqual([5, 5])
    expect(turnsOf(0, 10, 1)).toBe(10)
    expect(turnsOf(3, 2, 4)).toBe(0)
  })
  it('the leaders: the highest score, a tie shares it; nobody leads at zero all', () => {
    expect(leaders([2, 5, 1])).toEqual([1])
    expect(leaders([3, 3, 1])).toEqual([0, 1])
    expect(leaders([0, 0])).toEqual([])
    expect(leaders([])).toEqual([])
  })
})

/** Players of one game passing the device round (no accounts, no network): the player whose turn it is in round `round`. */
export const playerOf = (round: number, players: number): number => (players > 1 ? round % players : 0)

/** `scores` with `point` (0 or 1) added to `player`'s; a new list. */
export const scored = (scores: readonly number[], player: number, point: number): number[] => scores.map((s, i) => (i === player ? s + point : s))

/** The players with the highest score (a tie shares it); none when nobody scored. */
export function leaders(scores: readonly number[]): number[] {
  const top = Math.max(0, ...scores)
  return top > 0 ? scores.flatMap((s, i) => (s === top ? [i] : [])) : []
}

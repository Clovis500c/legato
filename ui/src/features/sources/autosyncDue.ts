/** YouTube Music brought in again this often while the app is open (Settings › Accounts, off by default). */
export const EVERY = 15 * 60_000
/** After Google refused this PC: a block lasted 5 min on 2026-10-31, asking again sooner only keeps it going. */
export const AFTER_REFUSAL = 30 * 60_000

/** Is an automatic sync due? `last`: the latest sync, by hand or not. None yet: now, at launch. */
export function due(last: { at: number; refused: boolean } | undefined, now: number): boolean {
  if (!last) return true
  return now - last.at >= (last.refused ? AFTER_REFUSAL : EVERY)
}

// The embed not answering after its load (a network error page, a lookup failure on 4G): our words over it, tried
// again. Not Google's refusal ("Sorry…", 429): refused.js keeps that one, never tried quicker.

/** No word from the frame this long after its load: down. A slow but working network answers well before. */
export const DOWN_MS = 10_000

/** Wait before the n-th try again (0 = the first): 5 s, doubled each time, at most 2 min. */
export const retryWait = (n: number) => Math.min(5000 * 2 ** Math.max(0, n), 120_000)

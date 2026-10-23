export type Hint = 'longer' | 'lower' | 'upper' | 'digit' | 'symbol' | 'repeats' | 'common'

const CLASSES: [Hint, RegExp, number][] = [
  ['lower', /[a-z]/, 26],
  ['upper', /[A-Z]/, 26],
  ['digit', /\d/, 10],
  ['symbol', /[^a-zA-Z\d]/, 33],
]
const COMMON = /password|motdepasse|azerty|qwerty|123456|abcdef|azertyuiop|iloveyou|soleil|bonjour/i

/** Rough strength, 0 (too short) to 4 (very strong), plus what to add. Brute-force bits with penalties, no dictionary. */
export function strength(pw: string, min: number): { level: 0 | 1 | 2 | 3 | 4; hints: Hint[] } {
  const hints: Hint[] = []
  let pool = 0
  for (const [hint, re, size] of CLASSES) {
    if (re.test(pw)) pool += size
    else hints.push(hint)
  }
  let bits = pw.length * Math.log2(Math.max(pool, 1))
  if (new Set(pw).size < pw.length / 2) {
    bits /= 2
    hints.push('repeats')
  }
  if (COMMON.test(pw)) {
    bits /= 2
    hints.push('common')
  }
  if (pw.length < 16) hints.unshift('longer')
  const level = pw.length < min ? 0 : bits < 50 ? 1 : bits < 70 ? 2 : bits < 90 ? 3 : 4
  return { level, hints }
}

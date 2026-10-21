/** Line being sung at `ms` (the last one started), -1 before the first. Lines sorted by time. */
export function lineAt(lines: { ms: number }[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].ms <= ms) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** The genres a library leans to, for the radio's starter stations: local files' genre tags weighed by how often they were
 *  played (a song counts once more per listen), the `n` heaviest, lower case. Computed here, never sent as a list. */
export function topGenres(tracks: { id: number; genre?: string }[], stats: Record<number, [number, ...unknown[]]>, n = 2): string[] {
  const weight = new Map<string, number>()
  for (const t of tracks) {
    const g = t.genre?.trim().toLowerCase()
    if (g && g.length <= 40) weight.set(g, (weight.get(g) ?? 0) + 1 + (stats[t.id]?.[0] ?? 0))
  }
  return [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([g]) => g)
}

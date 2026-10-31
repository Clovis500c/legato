// Release notes from commit subjects. Shared by scripts/release.mjs (every beta: the commits since the previous release)
// and scripts/promote.mjs (a Stable: everything since the previous Stable), so both say it the same way.
const MAX_NOTES = 20

/** "feat(player): smoother fades" → "Smoother fades". Other kinds (docs, ci, chore…) left out. */
export function notesFrom(subjects) {
  const lines = subjects
    .map((s) => /^(?:feat|fix|perf)(?:\([^)]*\))?!?:\s*(.+)$/.exec(s.trim())?.[1])
    .filter(Boolean)
    .map((s) => `- ${s[0].toUpperCase()}${s.slice(1)}`)
  if (!lines.length) return 'Small fixes and improvements.'
  return lines.length > MAX_NOTES ? [...lines.slice(0, MAX_NOTES), `- And ${lines.length - MAX_NOTES} more`].join('\n') : lines.join('\n')
}

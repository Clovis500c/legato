// Release notes from commit subjects. Shared by scripts/release.mjs (every beta: the commits since the previous release)
// and scripts/promote.mjs (a Stable: everything since the previous Stable), so both say it the same way. Every line goes
// in, grouped (the owner's rule, 2026-11-05: no "And 39 more").
/** Sections in the order shown. The app reads these headers and says them in the user's language (`features/update/notes.ts`). */
const KINDS = [
  ['feat', 'Added'],
  ['fix', 'Fixed'],
  ['perf', 'Performance improved'],
]
/** "feat(player): smoother fades" → "Smoother fades" under "### Added". Other kinds (docs, ci, chore…) left out, and the
 *  website's (scope site): the update card is the app's (2026-11-01: a beta's card listed the scroll story's six). */
export function notesFrom(subjects) {
  const items = subjects
    .map((s) => /^(feat|fix|perf)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(s.trim()))
    .filter((m) => m && m[2] !== 'site')
    .map(([, kind, , s]) => ({ kind, line: `- ${s[0].toUpperCase()}${s.slice(1)}` }))
  if (!items.length) return 'Small fixes and improvements.'
  const out = KINDS.flatMap(([kind, title]) => {
    const lines = items.filter((i) => i.kind === kind).map((i) => i.line)
    return lines.length ? [`### ${title}`, ...lines, ''] : []
  })
  return out.join('\n').trim()
}

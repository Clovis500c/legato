// Release notes from commit subjects. Shared by scripts/release.mjs (every beta: the commits since the previous release)
// and scripts/promote.mjs (a Stable: everything since the previous Stable), so both say it the same way.
const MAX_NOTES = 20
/** Sections in the order shown. The app reads these headers and says them in the user's language (`features/update/notes.ts`). */
const KINDS = [
  ['feat', 'New'],
  ['fix', 'Fixed'],
  ['perf', 'Faster'],
]
/** "feat(player): smoother fades" → "Smoother fades" under "### New". Other kinds (docs, ci, chore…) left out, and the
 *  website's (scope site): the update card is the app's (2026-11-01: a beta's card listed the scroll story's six). */
export function notesFrom(subjects) {
  const items = subjects
    .map((s) => /^(feat|fix|perf)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(s.trim()))
    .filter((m) => m && m[2] !== 'site')
    .map(([, kind, , s]) => ({ kind, line: `- ${s[0].toUpperCase()}${s.slice(1)}` }))
  if (!items.length) return 'Small fixes and improvements.'
  const kept = items.slice(0, MAX_NOTES)
  const out = KINDS.flatMap(([kind, title]) => {
    const lines = kept.filter((i) => i.kind === kind).map((i) => i.line)
    return lines.length ? [`### ${title}`, ...lines, ''] : []
  })
  if (items.length > MAX_NOTES) out.push(`And ${items.length - MAX_NOTES} more.`)
  return out.join('\n').trim()
}

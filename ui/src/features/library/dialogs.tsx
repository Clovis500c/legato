import { Copy } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { create } from 'zustand'
import { DuplicatesDialog, EditInfo } from '../../app/pages'
import { PageBoundary } from '../../app/PageBoundary'
import { useStore } from '../../app/store'
import type { LibraryTrack } from '../../shared/api'
import { trn } from '../../shared/i18n/i18n'
import { duplicateGroups } from './duplicates'

// The duplicate finder and Edit song info seen from outside: what opens them, where App mounts them. The dialogs load
// on first use.

/** What the finder looks at: the whole library, or some songs (a playlist, a list, a selection). */
export interface DupeScope {
  /** Where (dialog title): "Duplicates in Chill". */
  name?: string
  /** Songs looked at (library ids); none = the whole library. */
  ids?: number[]
  /** Custom playlist: the same song more than once in it can go too. */
  playlistId?: number
}

const useDupes = create<{ scope: DupeScope | null }>(() => ({ scope: null }))
/** Opens the duplicate finder (right-click on playlists, lists, selections: user's request 2026-10-23). */
export const findDuplicates = (scope: DupeScope = {}) => useDupes.setState({ scope })

/** Mounted once (App): the finder wherever it was opened from. */
export function DuplicatesHost() {
  const scope = useDupes((s) => s.scope)
  return (
    scope && (
      <PageBoundary fallback={null}>
        <DuplicatesDialog scope={scope} onClose={() => useDupes.setState({ scope: null })} />
      </PageBoundary>
    )
  )
}

/** Songs page button: shows only when the library has duplicates. */
export function DuplicatesButton() {
  const tracks = useStore((s) => s.tracks)
  const count = useMemo(() => duplicateGroups(tracks).length, [tracks])
  if (!count) return null
  return (
    <button type="button" onClick={() => findDuplicates()} className="flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink-2 hover:bg-raised hover:text-ink">
      <Copy size={14} /> {trn(count, '{n} duplicate', '{n} duplicates')}
    </button>
  )
}

const useEditInfo = create<{ track: LibraryTrack | null }>(() => ({ track: null }))

/** Right-click › Edit song info, on a local file. */
export const editInfo = (t: LibraryTrack) => useEditInfo.setState({ track: t })

/** Mounted once in App. */
export function EditInfoHost() {
  const t = useEditInfo((s) => s.track)
  return (
    t && (
      <PageBoundary fallback={null}>
        <EditInfo key={t.id} t={t} onClose={() => useEditInfo.setState({ track: null })} />
      </PageBoundary>
    )
  )
}

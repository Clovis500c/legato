import { Copy } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type Source } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { bestCopy, duplicateGroups, repeatedRows } from './duplicates'
import { removePositions } from './edits'

/** One group: pick the copy to keep (the best one already picked), merge the others into it. */
function Group({ group, keep, onKeep, onMerge, busy }: { group: LibraryTrack[]; keep: number; onKeep: (id: number) => void; onMerge: () => void; busy: boolean }) {
  const stats = useStore((s) => s.stats)
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-line p-2">
      {group.map((t) => (
        <label key={t.id} className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 ${t.id === keep ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
          <input type="radio" name={`keep-${group[0].id}`} checked={t.id === keep} onChange={() => onKeep(t.id)} className="accent-(--accent)" />
          <Cover title={t.album ?? t.title} art={trackArt(t)} size={34} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.8125rem] font-semibold">{t.title}</span>
            <span className="truncate text-xs text-ink-2">{[t.artist, t.album].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-ink-3">
            {(Object.keys(t.ids) as Source[]).map((s) => (
              <SourceIcon key={s} source={s} size={12} />
            ))}
          </span>
          <span className="w-16 text-right text-xs text-ink-3 tabular-nums">{trn(stats[t.id]?.[0] ?? 0, '{n} play', '{n} plays')}</span>
          <span className="w-10 text-right text-xs text-ink-3 tabular-nums">{formatDuration(t.durationMs)}</span>
        </label>
      ))}
      <Button variant="ghost" className="mt-1 self-end" disabled={busy} onClick={onMerge}>
        {tr('Merge into the one picked')}
      </Button>
    </li>
  )
}

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

/**
 * Songs that look like the same one (a video and the album track, an import twice): merged, they become one song
 * with every source, playlist spot and play. Live takes, remixes, slowed versions stay apart.
 */
function DuplicatesDialog({ scope, onClose }: { scope: DupeScope; onClose: () => void }) {
  const { tracks: all, stats, refreshChanged, notify, orders, playlists } = useStore(useShallow(({ tracks, stats, refreshChanged, notify, orders, playlists }) => ({ tracks, stats, refreshChanged, notify, orders, playlists })))
  const tracks = useMemo(() => {
    if (!scope.ids) return all
    const ids = new Set(scope.ids)
    return all.filter((t) => ids.has(t.id))
  }, [all, scope.ids])
  const groups = useMemo(() => duplicateGroups(tracks), [tracks])
  const custom = scope.playlistId !== undefined && playlists.some((p) => p.id === scope.playlistId && p.custom)
  const repeats = custom ? repeatedRows(orders[scope.playlistId!] ?? []) : []
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const keepOf = (g: LibraryTrack[]) => picked[g[0].id] ?? bestCopy(g, stats).id
  const merge = async (list: LibraryTrack[][]) => {
    setBusy(true)
    try {
      for (const g of list) {
        const keep = keepOf(g)
        await api.mergeTracks(
          keep,
          g.map((t) => t.id).filter((id) => id !== keep),
        )
      }
      await refreshChanged()
      notify(trn(list.length, 'Merged {n} song', 'Merged {n} songs'))
    } catch (e) {
      notify(String(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const dropRepeats = async () => {
    setBusy(true)
    await removePositions(scope.playlistId!, repeats)
    setBusy(false)
  }
  return (
    <Dialog title={scope.name ? tr('Duplicates in {name}', { name: scope.name }) : tr('Duplicates')} onClose={onClose}>
      {repeats.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3">
          <span className="flex-1 text-[0.8125rem]">{trn(repeats.length, '{n} song is in this playlist twice', '{n} songs are in this playlist more than once')}</span>
          <Button variant="ghost" disabled={busy} onClick={() => void dropRepeats()}>
            {trn(repeats.length, 'Remove {n} repeat', 'Remove {n} repeats')}
          </Button>
        </div>
      )}
      {groups.length ? (
        <>
          <p className="text-xs text-ink-2">{tr('Merged, each becomes one song with every source, playlist spot and play. Live takes, remixes and slowed versions stay apart.')}</p>
          <ul className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            {groups.map((g) => (
              <Group key={g[0].id} group={g} keep={keepOf(g)} onKeep={(id) => setPicked((p) => ({ ...p, [g[0].id]: id }))} onMerge={() => void merge([g])} busy={busy} />
            ))}
          </ul>
          <Button disabled={busy} onClick={() => void merge(groups)}>
            {tr('Merge all ({n})', { n: groups.length })}
          </Button>
        </>
      ) : (
        !repeats.length && <p className="py-6 text-center text-ink-3">{scope.ids ? tr('No duplicates here.') : tr('No duplicates in your library.')}</p>
      )}
    </Dialog>
  )
}

/** Mounted once (App): the finder wherever it was opened from. */
export function DuplicatesHost() {
  const scope = useDupes((s) => s.scope)
  return scope && <DuplicatesDialog scope={scope} onClose={() => useDupes.setState({ scope: null })} />
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

import { MagnifyingGlass, PencilSimple, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pageQuery, useStore } from '../../app/store'
import { api, type LibraryHealth, type LibraryTrack } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { LedChip, RoundButton } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { brokenVideos, forgetBroken } from './broken'
import { editInfo, findDuplicates } from './dialogs'
import { duplicateGroups } from './duplicates'
import { filterTracks } from './filter'
import { healthGroups } from './health'
import { TrackTable } from './TrackTable'

type Group = 'gone' | 'broken' | 'cover' | 'info'
const ORDER: Group[] = ['gone', 'broken', 'cover', 'info']

/** Songs that need a hand, a group at a time: files gone, videos that can't play, no cover, missing artist or album.
 *  Songs not found and duplicates have their own page and dialog: linked. */
export function HealthView() {
  const { tracks, notFound, searchFor, go } = useStore(useShallow(({ tracks, notFound, searchFor, go }) => ({ tracks, notFound: notFound.length, searchFor, go })))
  const query = useStore(pageQuery)
  const [scan, setScan] = useState<LibraryHealth | null>(null)
  const [broken, setBroken] = useState(brokenVideos)
  const [pick, setPick] = useState<Group | null>(null)
  // Again after each library change: a song fixed here leaves its group.
  useEffect(() => {
    let live = true
    api
      .libraryHealth()
      .then((h) => live && setScan(h))
      .catch(() => live && setScan({ gone: [], noCover: [] }))
    return () => {
      live = false
    }
  }, [tracks])
  const groups = useMemo(() => ({ gone: scan?.gone ?? [], ...healthGroups(tracks, scan?.noCover ?? [], new Set(broken.map((b) => b.video))) }), [scan, tracks, broken])
  const why = useMemo(() => new Map(broken.map((b) => [b.video, b.why])), [broken])
  const dupes = useMemo(() => duplicateGroups(tracks).length, [tracks])
  const group = pick ?? ORDER.find((g) => groups[g].length) ?? 'gone'
  const shown = useMemo(() => filterTracks(groups[group], query, 'all'), [groups, group, query])
  const total = ORDER.reduce((n, g) => n + groups[g].length, 0)
  const find = (t: LibraryTrack) => searchFor(`${t.artist} ${t.title}`, undefined, { id: t.id, title: t.title, artist: t.artist })
  const label: Record<Group, string> = { gone: tr('Files gone'), broken: tr('Can’t play'), cover: tr('No cover'), info: tr('Missing info') }
  const about: Record<Group, string> = {
    gone: tr('Moved or deleted, still in a playlist: find them on YouTube, or put the files back in a watched folder.'),
    broken: tr('YouTube says their video can’t play (removed, private, not in your country): pick another version.'),
    cover: tr('Local files with no picture inside: Edit song info adds one.'),
    info: tr('Local files without an artist or an album: Edit song info fills them in, many at once.'),
  }
  const editing = group === 'cover' || group === 'info'
  const busy = !scan && tr('Looking through your library…')
  return (
    <>
      <PageHeader title={tr('Library health')} sub={busy || (total ? trn(total, '{n} song to look at', '{n} songs to look at') : tr('Nothing to fix'))} />
      <div role="tablist" aria-label={tr('Library health')} className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
        {ORDER.map((g) => (
          <LedChip key={g} on={g === group} label={label[g]} count={String(groups[g].length)} onClick={() => setPick(g)} />
        ))}
        {notFound > 0 && <LedChip on={false} label={tr('Songs not found')} count={String(notFound)} onClick={() => go({ name: 'notFound' })} />}
        {dupes > 0 && <LedChip on={false} label={tr('Duplicates')} count={String(dupes)} onClick={() => findDuplicates()} />}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 pb-3">
        <p className="min-w-0 text-[0.8125rem] text-ink-2">{about[group]}</p>
        {editing && groups[group].length > 1 && (
          <Button variant="ghost" className="shrink-0" onClick={() => editInfo(groups[group])}>
            <PencilSimple size={16} /> {trn(groups[group].length, 'Edit info of {n} song', 'Edit info of {n} songs')}
          </Button>
        )}
      </div>
      <TrackTable
        tracks={shown}
        rowActions={(t) =>
          editing ? (
            <RoundButton label={tr('Edit song info')} kind="plain" size="xs" onClick={() => editInfo([t])}>
              <PencilSimple size={14} />
            </RoundButton>
          ) : (
            <>
              <RoundButton label={group === 'broken' ? `${tr('Find another version')} (${why.get(t.ids.youtube ?? '') ?? ''})` : tr('Find this song')} kind="plain" size="xs" onClick={() => find(t)}>
                <MagnifyingGlass size={14} />
              </RoundButton>
              {group === 'broken' && (
                <RoundButton label={tr('It plays now')} kind="plain" size="xs" onClick={() => (forgetBroken([t.ids.youtube ?? '']), setBroken(brokenVideos()))}>
                  <X size={14} />
                </RoundButton>
              )}
            </>
          )
        }
        empty={<p className="text-base text-ink">{busy || tr('Nothing to fix')}</p>}
      />
    </>
  )
}

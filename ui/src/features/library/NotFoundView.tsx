import { MagnifyingGlass } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { pageQuery, useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { RoundButton } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { filterTracks } from './filter'
import { TrackTable } from './TrackTable'

/** Songs YouTube had no version of: to look through, find by hand, or search again. */
export function NotFoundView() {
  const { tracks, notFound, running, searchFor, importSpotifyLists } = useStore(useShallow(({ tracks, notFound, importRun, searchFor, importSpotifyLists }) => ({ tracks, notFound, running: !!importRun, searchFor, importSpotifyLists })))
  const query = useStore(pageQuery)
  const songs = useMemo(() => {
    const ids = new Set(notFound)
    return tracks.filter((t) => ids.has(t.id))
  }, [tracks, notFound])
  const shown = useMemo(() => filterTracks(songs, query, 'all'), [songs, query])
  return (
    <>
      <PageHeader title={tr('Songs not found')} sub={songs.length > 0 && trn(songs.length, '{n} song not found', '{n} songs not found')} />
      {songs.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-4 pb-3">
          <p className="min-w-0 text-[0.8125rem] text-ink-2">{tr('YouTube has no version that matches, so they can’t play. A new import looks again after a month.')}</p>
          <Button variant="ghost" className="shrink-0" disabled={running} onClick={() => void importSpotifyLists(() => api.notFoundSearch(), true)}>
            <MagnifyingGlass size={16} /> {tr('Search again')}
          </Button>
        </div>
      )}
      <TrackTable
        tracks={shown}
        rowActions={(t) => (
          <RoundButton label={tr('Find this song')} kind="plain" size="xs" onClick={() => searchFor(`${t.artist} ${t.title}`)}>
            <MagnifyingGlass size={14} />
          </RoundButton>
        )}
        empty={<p className="text-base text-ink">{tr('Every song searched has a version')}</p>}
      />
    </>
  )
}

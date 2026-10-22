import { Playlist } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { playlistKey, type LibraryPlaylist } from '../../shared/api'
import { coverImage, trackArt } from '../../shared/art'
import { Cover } from '../../shared/ui/Cover'
import { CoverGrid } from '../../shared/ui/CoverGrid'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { coverTracks } from './covers'

/**
 * Playlist icon as chosen (right-click › Cover): service logo, first song, grid of 4, or a picked image. big = page
 * header: the logo there falls back to the first song's cover.
 */
export function PlaylistCover({ p, size, big = false }: { p: LibraryPlaylist; size: number; big?: boolean }) {
  const pick = useSettings((s) => s.settings.playlistCovers[playlistKey(p)])
  const ids = useStore((s) => s.orders[p.id])
  const tracks = useStore((s) => s.tracks)
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const mode = pick?.mode ?? (big ? 'first' : 'source')
  const order = pick?.order ?? 'playlist'
  const songs = useMemo(() => (mode === 'first' || mode === 'grid' || (big && mode === 'source') ? coverTracks(ids, byId, order, mode === 'grid' ? 4 : 1) : []), [mode, big, ids, byId, order])
  const round = big ? '' : 'rounded-[4px]!'

  if (mode === 'image' && pick?.image) return <Cover title={p.name} art={[coverImage(pick.image)]} size={size} eager={big} className={round} />
  if (mode === 'grid' && songs.length === 4)
    return <CoverGrid arts={songs.map(trackArt)} size={size} className={round} />
  if (songs.length) return <Cover title={p.name} art={trackArt(songs[0])} size={size} eager={big} className={round} />
  if (big) return <Cover title={p.name} size={size} />
  return p.custom ? <Playlist size={15} /> : <SourceIcon source={p.source} size={14} />
}

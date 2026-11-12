import { useEffect, useMemo } from 'react'
import { useStore } from '../../app/store'
import { artistName } from '../../shared/artistName'
import { tr } from '../../shared/i18n/i18n'
import { Cover } from '../../shared/ui/Cover'
import { asksPicture } from '../addons/presence'
import { fetchPicture, pictureKey, usePictures } from '../library/artistPicture'
import { allArtists } from '../library/filter'
import { usePlayer, type NowPlaying } from './store'

/**
 * The big title's artists (the owner's ask 2026-11-07): each name, its round picture on its right once known; a click
 * opens their page. Pictures: the artist page's own, already kept (Rust's cache); YouTube Music is asked only for a
 * song YouTube plays, 10 s in, each artist once and one at a time (`artist_picture`; a miss waits 6 hours), then it
 * is kept. None known: the name alone.
 */
export function ArtistLine({ now, className = '' }: { now: NowPlaying; className?: string }) {
  const names = useMemo(() => allArtists(now.artist), [now.artist])
  const pictures = usePictures()
  const ripe = usePlayer((s) => s.now?.via === 'youtube' && asksPicture(s.now, s.playing, s.positionMs))
  useEffect(() => {
    for (const name of names) {
      fetchPicture(name, ripe)
    }
  }, [names, ripe])
  const open = (artist: string) => {
    usePlayer.getState().setFull(false)
    useStore.getState().go({ name: 'artist', artist })
  }
  return (
    <div className={`flex max-w-full flex-wrap items-center gap-x-5 gap-y-2 ${className}`}>
      {names.map((name) => {
        const art = pictures[pictureKey(name)]
        const inner = (
          <>
            <span className="min-w-0 truncate group-hover:underline">{artistName(name)}</span>
            {art && <Cover title={name} art={[art]} size={32} className="rounded-full! border-0! shadow-[0_2px_10px_var(--shadow)]" />}
          </>
        )
        // A dropped file has no artist page to open.
        return now.trackId === undefined ? (
          <span key={name} className="flex min-w-0 items-center gap-2.5">
            {inner}
          </span>
        ) : (
          <button key={name} type="button" title={tr('Go to artist')} onClick={() => open(name)} className="group flex min-w-0 items-center gap-2.5 text-left hover:text-ink">
            {inner}
          </button>
        )
      })}
    </div>
  )
}

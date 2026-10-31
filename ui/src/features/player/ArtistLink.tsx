import { useStore } from '../../app/store'
import { artistName } from '../../shared/artistName'
import { tr } from '../../shared/i18n/i18n'
import { primaryArtist } from '../library/filter'
import { usePlayer, type NowPlaying } from './store'

/** The playing song's artist: a click opens their page (Now Playing closes). A dropped file has none to open. */
export function ArtistLink({ now, className = '' }: { now: NowPlaying; className?: string }) {
  if (now.trackId === undefined) return <span className={className}>{artistName(now.artist)}</span>
  const open = () => {
    usePlayer.getState().setFull(false)
    useStore.getState().go({ name: 'artist', artist: primaryArtist(now.artist) })
  }
  return (
    <button type="button" title={tr('Go to artist')} onClick={open} className={`text-left hover:text-ink hover:underline ${className}`}>
      {artistName(now.artist)}
    </button>
  )
}

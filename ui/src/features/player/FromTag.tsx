import { Disc, MicrophoneStage, MusicNotesSimple, Path, Playlist, Radio, Shuffle, Sparkle } from '@phosphor-icons/react'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { PlaylistCover } from '../library/PlaylistCover'
import { fromAria, type FromKind } from './fromLabel'
import { usePlayer } from './store'

const ICONS: Record<FromKind, typeof Disc> = { playlist: Playlist, album: Disc, artist: MicrophoneStage, songs: MusicNotesSimple, radio: Radio, mix: Sparkle, walk: Path, dj: Shuffle }

/**
 * Now Playing's "From <icon> <name>": where the queue was started, its name in bold after the list's own small cover (a playlist) or
 * the house icon of its kind. One label for a screen reader ("From <name>"), a long name cut with the whole of it in the tooltip, mirrored in right-to-left.
 */
export function FromTag({ className = '' }: { className?: string }) {
  const from = usePlayer((s) => s.from)
  const kind = usePlayer((s) => s.fromKind)
  const id = usePlayer((s) => s.fromId)
  const playlist = useStore((s) => (kind === 'playlist' && id !== undefined ? s.playlists.find((p) => p.id === id) : undefined))
  if (!from) return null
  const Icon = kind ? ICONS[kind] : Playlist
  return (
    <p role="group" aria-label={fromAria(tr('From'), from)} title={from} className={`kicker flex min-w-0 items-center gap-1.5 ${className}`}>
      <span aria-hidden>{tr('From')}</span>
      <span aria-hidden className="grid size-4 shrink-0 place-items-center overflow-hidden rounded-[3px]">
        {playlist ? <PlaylistCover p={playlist} size={16} /> : <Icon size={14} />}
      </span>
      <b aria-hidden className="min-w-0 truncate font-bold text-ink">
        {from}
      </b>
    </p>
  )
}

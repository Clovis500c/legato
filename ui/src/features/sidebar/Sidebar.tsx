import { Disc, Gear, House, MicrophoneStage, MusicNotes, Plus, PlusCircle, PuzzlePiece, VinylRecord } from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { playlistKey } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Led } from '../../shared/ui/controls'
import { onMenu } from '../../shared/ui/ContextMenu'
import { PlaylistCover } from '../library/PlaylistCover'
import { canDropOn, dropOn, playlistMenu, playlistsMenu } from '../menus'
import { dragged, isTrackDrag } from '../library/drag'
import { groupAlbums, groupArtists } from '../library/filter'
import { tr } from '../../shared/i18n/i18n'
import { SidebarPlayer } from '../player/SidebarPlayer'

/** onSongs: songs dragged from a list may be dropped here (a playlist). */
function NavItem({ on, icon, label, count, onClick, onContextMenu, onSongs }: { on: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; onSongs?: (ids: number[]) => void }) {
  const counts = useSettings((s) => s.settings.sidebarCounts)
  const [over, setOver] = useState(false)
  const drop = onSongs && {
    onDragOver: (e: React.DragEvent) => {
      if (!isTrackDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const ids = dragged()?.ids
      if (ids?.length) onSongs(ids)
    },
  }
  return (
    <button aria-current={on ? 'page' : undefined} onClick={onClick} onContextMenu={onContextMenu} {...drop} className={`flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2.5 pl-1 text-left transition ${on ? 'bg-raised font-semibold text-ink' : 'text-ink-2 hover:text-ink'} ${over ? 'bg-accent-soft text-ink ring-1 ring-accent' : ''}`}>
      <span className="w-1.5">{on && <Led on />}</span>
      <span className={on ? 'text-ink' : 'text-ink-3'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && counts && <span className="font-mono text-[0.625rem] text-ink-3">{formatCount(count)}</span>}
    </button>
  )
}

const Section = ({ title, children, onContextMenu }: { title: string; children: ReactNode; onContextMenu?: (e: React.MouseEvent) => void }) => (
  <section className="flex flex-col gap-px">
    <h2 onContextMenu={onContextMenu} className="kicker px-4.5 pb-1.5">
      {title}
    </h2>
    {children}
  </section>
)

export function Sidebar() {
  const { view, go, tracks, playlists, editPlaylist } = useStore(
    useShallow((s) => ({ view: s.view, go: s.go, tracks: s.tracks, playlists: s.playlists, editPlaylist: s.editPlaylist })),
  )
  const counts = useMemo(() => ({ albums: groupAlbums(tracks).length, artists: groupArtists(tracks).length }), [tracks])
  const is = (name: View['name']) => view.name === name
  const hidden = useSettings((s) => s.settings.hiddenPlaylists)
  const hiddenKeys = useMemo(() => new Set(hidden), [hidden])

  return (
    // Footer stays put; only the lists scroll (a small window used to scroll the whole sidebar). Search: top bar.
    <aside className="flex w-63 shrink-0 flex-col border-r border-line bg-panel">
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-3 pb-3">
        <div className="flex flex-col gap-px">
          <NavItem on={is('home')} icon={<House size={16} />} label={tr('Home')} onClick={() => go({ name: 'home' })} />
          <NavItem on={is('mixes') || is('mix')} icon={<Disc size={16} />} label={tr('Mixes')} onClick={() => go({ name: 'mixes' })} />
          <NavItem on={is('add')} icon={<PlusCircle size={16} />} label={tr('Add music')} onClick={() => go({ name: 'add' })} />
        </div>

        <Section title={tr('Library')}>
          <NavItem on={is('songs')} icon={<MusicNotes size={16} />} label={tr('Songs')} count={tracks.length} onClick={() => go({ name: 'songs' })} />
          <NavItem on={is('albums') || is('album')} icon={<VinylRecord size={16} />} label={tr('Albums')} count={counts.albums} onClick={() => go({ name: 'albums' })} />
          <NavItem on={is('artists') || is('artist')} icon={<MicrophoneStage size={16} />} label={tr('Artists')} count={counts.artists} onClick={() => go({ name: 'artists' })} />
        </Section>

        <Section title={tr('Playlists')} onContextMenu={onMenu(playlistsMenu)}>
          {playlists
            .filter((p) => !hiddenKeys.has(playlistKey(p)))
            .map((p) => (
            <NavItem key={p.id} on={view.name === 'playlist' && view.id === p.id} icon={<PlaylistCover p={p} size={18} />} label={p.name} count={p.trackCount} onClick={() => go({ name: 'playlist', id: p.id })} onContextMenu={onMenu(() => playlistMenu(p))} onSongs={canDropOn(p) ? (ids) => dropOn(p, ids) : undefined} />
          ))}
          <NavItem
            on={false}
            icon={<Plus size={14} />}
            label={tr('New playlist')}
            onClick={async () => {
              const id = await editPlaylist({ type: 'create', name: tr('New playlist') })
              if (id !== null) go({ name: 'playlist', id })
            }}
          />
        </Section>
      </div>

      <SidebarPlayer />
      <div className="flex shrink-0 flex-col gap-px border-t border-line-soft px-3 pt-2 pb-3.5">
        <NavItem on={is('addons')} icon={<PuzzlePiece size={16} />} label={tr('Add-ons')} onClick={() => go({ name: 'addons' })} />
        <NavItem on={is('settings')} icon={<Gear size={16} />} label={tr('Settings')} onClick={() => go({ name: 'settings', section: 'general' })} />
      </div>
    </aside>
  )
}

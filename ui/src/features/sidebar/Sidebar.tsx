import { ChartBar, Disc, Lightning, Gear, House, MicrophoneStage, MusicNotes, Plus, PlusCircle, PuzzlePiece, SortAscending, VinylRecord } from '@phosphor-icons/react'
import { useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { playlistKey } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Led, RoundButton } from '../../shared/ui/controls'
import { onMenu, openMenu } from '../../shared/ui/ContextMenu'
import type { PlaylistOrder } from '../../shared/theme/theme'
import { byOpened, useOpenedLists } from '../home/recentLists'
import { PlaylistCover } from '../library/PlaylistCover'
import { canDropOn, dropOn, navMenu, playlistMenu, playlistsMenu } from '../menus'
import { useDrag, useDropTarget } from '../../shared/ui/drag'
import { usePlayer } from '../player/store'
import { groupAlbums, groupArtists } from '../library/filter'
import { msg, tr } from '../../shared/i18n/i18n'
import { SidebarPlayer } from '../player/SidebarPlayer'
import { newSmartList, smartTracks } from '../smart/rules'
import { saveSmart, smartMenu } from '../smart/SmartView'

/** onSongs: songs dragged from a list or Up next may be dropped here (a playlist), `dropId` names the target. */
function NavItem({ on, icon, label, count, onClick, onContextMenu, onSongs, dropId }: { on: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; onSongs?: (ids: number[]) => void; dropId?: string }) {
  const counts = useSettings((s) => s.settings.sidebarCounts)
  const target = dropId ?? `nav-${label}`
  useDropTarget(
    target,
    onSongs
      ? {
          accepts: (d) => d.kind === 'tracks' || d.kind === 'queue',
          drop: (d) => {
            const ids = d.kind === 'tracks' ? d.ids : d.kind === 'queue' ? [usePlayer.getState().list[d.i]?.id].filter((x) => x !== undefined) : []
            if (ids.length) onSongs(ids)
          },
        }
      : null,
  )
  const over = useDrag((s) => s.target === target)
  return (
    <button aria-current={on ? 'page' : undefined} onClick={onClick} onContextMenu={onContextMenu} data-drop={onSongs ? target : undefined} className={`flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2.5 pl-1 text-left transition ${on ? 'bg-raised font-semibold text-ink' : 'text-ink-2 hover:text-ink'} ${over ? 'bg-accent-soft text-ink ring-1 ring-accent' : ''}`}>
      <span className="w-1.5">{on && <Led on />}</span>
      <span className={on ? 'text-ink' : 'text-ink-3'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && counts && <span className="font-mono text-[0.625rem] text-ink-3">{formatCount(count)}</span>}
    </button>
  )
}

const Section = ({ title, children, onContextMenu, tools }: { title: string; children: ReactNode; onContextMenu?: (e: React.MouseEvent) => void; tools?: ReactNode }) => (
  <section className="flex flex-col gap-px">
    <div onContextMenu={onContextMenu} className="flex items-center justify-between pr-1 pb-1 pl-4.5">
      <h2 className="kicker">{title}</h2>
      {tools && <span className="flex items-center">{tools}</span>}
    </div>
    {children}
  </section>
)

const ORDERS: { id: PlaylistOrder; label: string }[] = [
  { id: 'custom', label: msg('As imported or made') },
  { id: 'name', label: msg('Name (A–Z)') },
  { id: 'songs', label: msg('Most songs') },
  { id: 'opened', label: msg('Opened lately') },
]
const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function Sidebar() {
  const { view, go, tracks, playlists, editPlaylist } = useStore(
    useShallow((s) => ({ view: s.view, go: s.go, tracks: s.tracks, playlists: s.playlists, editPlaylist: s.editPlaylist })),
  )
  const counts = useMemo(() => ({ albums: groupAlbums(tracks).length, artists: groupArtists(tracks).length }), [tracks])
  const is = (name: View['name']) => view.name === name
  const hidden = useSettings((s) => s.settings.hiddenPlaylists)
  const order = useSettings((s) => s.settings.playlistOrder)
  const opened = useOpenedLists((s) => s.list)
  const hiddenKeys = useMemo(() => new Set(hidden), [hidden])
  // The order picked stays (Spotify's sidebar kept going back to Recent: users' first complaint).
  const shown = useMemo(() => {
    const list = playlists.filter((p) => !hiddenKeys.has(playlistKey(p)))
    if (order === 'name') return [...list].sort((a, b) => coll.compare(a.name, b.name))
    if (order === 'songs') return [...list].sort((a, b) => b.trackCount - a.trackCount)
    return order === 'opened' ? byOpened(list, opened) : list
  }, [playlists, hiddenKeys, order, opened])
  const create = async () => {
    const id = await editPlaylist({ type: 'create', name: tr('New playlist') })
    if (id !== null) go({ name: 'playlist', id })
  }
  const createSmart = () => {
    const list = newSmartList(tr('Smart playlist'))
    saveSmart(list)
    go({ name: 'smart', id: list.id })
  }
  const smart = useSettings((s) => s.settings.smartLists)
  const stats = useStore((s) => s.stats)
  const smartSongs = useMemo(() => new Map(smart.map((l) => [l.id, smartTracks(l, tracks, stats).map((t) => t.id)])), [smart, tracks, stats])

  return (
    // Footer stays put; only the lists scroll (a small window used to scroll the whole sidebar). Search: top bar.
    <aside className="flex w-63 shrink-0 flex-col border-r border-line bg-panel">
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-3 pb-3">
        <div className="flex flex-col gap-px">
          <NavItem on={is('home')} icon={<House size={16} />} label={tr('Home')} onClick={() => go({ name: 'home' })} onContextMenu={onMenu(() => navMenu({ name: 'home' }))} />
          <NavItem on={is('mixes') || is('mix')} icon={<Disc size={16} />} label={tr('Mixes')} onClick={() => go({ name: 'mixes' })} onContextMenu={onMenu(() => navMenu({ name: 'mixes' }))} />
          <NavItem on={is('stats')} icon={<ChartBar size={16} />} label={tr('Stats')} onClick={() => go({ name: 'stats' })} onContextMenu={onMenu(() => navMenu({ name: 'stats' }))} />
          <NavItem on={is('add')} icon={<PlusCircle size={16} />} label={tr('Add music')} onClick={() => go({ name: 'add' })} onContextMenu={onMenu(() => navMenu({ name: 'add' }))} />
        </div>

        <Section title={tr('Library')}>
          <NavItem on={is('songs')} icon={<MusicNotes size={16} />} label={tr('Songs')} count={tracks.length} onClick={() => go({ name: 'songs' })} onContextMenu={onMenu(() => navMenu({ name: 'songs' }, useStore.getState().tracks))} />
          <NavItem on={is('albums') || is('album')} icon={<VinylRecord size={16} />} label={tr('Albums')} count={counts.albums} onClick={() => go({ name: 'albums' })} onContextMenu={onMenu(() => navMenu({ name: 'albums' }))} />
          <NavItem on={is('artists') || is('artist')} icon={<MicrophoneStage size={16} />} label={tr('Artists')} count={counts.artists} onClick={() => go({ name: 'artists' })} onContextMenu={onMenu(() => navMenu({ name: 'artists' }))} />
        </Section>

        <Section
          title={tr('Playlists')}
          onContextMenu={onMenu(playlistsMenu)}
          tools={
            <>
              <RoundButton label={tr('Sort playlists')} kind="plain" size="xs" onClick={(e) => openMenu(e, ORDERS.map((o) => ({ label: tr(o.label), checked: order === o.id, onSelect: () => useSettings.getState().update({ playlistOrder: o.id }) })))}>
                <SortAscending size={14} />
              </RoundButton>
              <RoundButton label={tr('New playlist')} kind="plain" size="xs" onClick={(e) => openMenu(e, [{ label: tr('New playlist'), icon: <Plus size={16} />, onSelect: () => void create() }, { label: tr('New smart playlist'), icon: <Lightning size={16} />, onSelect: createSmart }])}>
                <Plus size={14} />
              </RoundButton>
            </>
          }
        >
          {shown.map((p) => (
            <NavItem key={p.id} on={view.name === 'playlist' && view.id === p.id} icon={<PlaylistCover p={p} size={18} />} label={p.name} count={p.trackCount} onClick={() => go({ name: 'playlist', id: p.id })} onContextMenu={onMenu(() => playlistMenu(p))} onSongs={canDropOn(p) ? (ids) => dropOn(p, ids) : undefined} dropId={`playlist-${p.id}`} />
          ))}
          {smart.map((l) => (
            <NavItem key={l.id} on={view.name === 'smart' && view.id === l.id} icon={<Lightning size={16} weight="fill" className="text-accent" />} label={l.name || tr('Smart playlist')} count={smartSongs.get(l.id)?.length ?? 0} onClick={() => go({ name: 'smart', id: l.id })} onContextMenu={onMenu(() => smartMenu(l, smartSongs.get(l.id) ?? []))} />
          ))}
        </Section>
      </div>

      <SidebarPlayer />
      <div className="flex shrink-0 flex-col gap-px border-t border-line-soft px-3 pt-2 pb-3.5">
        <NavItem on={is('addons')} icon={<PuzzlePiece size={16} />} label={tr('Add-ons')} onClick={() => go({ name: 'addons' })} onContextMenu={onMenu(() => navMenu({ name: 'addons' }))} />
        <NavItem on={is('settings')} icon={<Gear size={16} />} label={tr('Settings')} onClick={() => go({ name: 'settings', section: 'general' })} onContextMenu={onMenu(() => navMenu({ name: 'settings', section: 'general' }))} />
      </div>
    </aside>
  )
}

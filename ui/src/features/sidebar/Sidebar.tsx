import { ChartBar, Disc, House, Lightning, MusicNotes, Plus, PlusCircle, SortAscending } from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { playlistKey, type LibraryPlaylist } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatCount } from '../../shared/format'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { VirtualList } from '../../shared/ui/VirtualList'
import type { PlaylistOrder } from '../../shared/theme/theme'
import { byOpened, useOpenedLists } from '../home/recentLists'
import { PlaylistCover } from '../library/PlaylistCover'
import { canDropOn, dropOn, navMenu, playlistMenu, playlistsMenu } from '../menus'
import { useDrag, useDropTarget } from '../../shared/ui/drag'
import { usePlayer } from '../player/store'
import { groupAlbums, groupArtists } from '../library/filter'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { SidebarPlayer } from '../player/SidebarPlayer'
import { newSmartList, smartTracks } from '../smart/rules'
import { saveSmart, smartMenu } from '../smart/SmartView'

/** Home, Mixes, Stats, Add music: icon Regular at rest, Fill when on (docs/design.md). */
function NavItem({ on, icon: Icon, label, onClick, onContextMenu }: { on: boolean; icon: typeof House; label: string; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button aria-current={on ? 'page' : undefined} onClick={onClick} onContextMenu={onContextMenu} className={`flex h-10 w-full items-center gap-4 rounded-md px-3 text-left text-[0.9375rem] font-medium transition ${on ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
      <Icon size={22} weight={on ? 'fill' : 'regular'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/** One row of Your library: everything it needs to draw and open. */
interface Entry {
  key: string
  on: boolean
  art: ReactNode
  label: string
  sub: string
  round?: boolean
  to: View
  menu: () => MenuEntry[]
  playlist?: LibraryPlaylist
}

/** Your library row: cover, name, kind and count. A playlist takes songs dragged from a list or Up next. */
function LibItem({ e }: { e: Entry }) {
  const go = useStore((s) => s.go)
  const target = e.playlist ? `playlist-${e.playlist.id}` : e.key
  const p = e.playlist && canDropOn(e.playlist) ? e.playlist : null
  useDropTarget(
    target,
    p
      ? {
          accepts: (d) => d.kind === 'tracks' || d.kind === 'queue',
          drop: (d) => {
            const ids = d.kind === 'tracks' ? d.ids : d.kind === 'queue' ? [usePlayer.getState().list[d.i]?.id].filter((x) => x !== undefined) : []
            if (ids.length) dropOn(p, ids)
          },
        }
      : null,
  )
  const over = useDrag((s) => s.target === target)
  return (
    <button aria-current={e.on ? 'page' : undefined} onClick={() => go(e.to)} onContextMenu={onMenu(e.menu)} data-drop={p ? target : undefined} className={`flex h-full w-full items-center gap-3 rounded-md px-2 text-left transition ${e.on || over ? 'bg-raised' : 'hover:bg-raised'} ${over ? 'ring-2 ring-ink' : ''}`}>
      <span className={`grid size-12 shrink-0 place-items-center overflow-hidden ${e.round ? 'rounded-full' : 'rounded-cover'}`}>{e.art}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{e.label}</span>
        <span className="block truncate text-[0.8125rem] text-ink-2">{e.sub}</span>
      </span>
    </button>
  )
}

const ORDERS: { id: PlaylistOrder; label: string }[] = [
  { id: 'custom', label: msg('As imported or made') },
  { id: 'name', label: msg('Name (A–Z)') },
  { id: 'songs', label: msg('Most songs') },
  { id: 'opened', label: msg('Opened lately') },
]
const KINDS = [
  { id: 'playlists', label: msg('Playlists') },
  { id: 'albums', label: msg('Albums') },
  { id: 'artists', label: msg('Artists') },
] as const
type Kind = (typeof KINDS)[number]['id']
const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const dot = (a: string, b: string) => (b ? `${a} · ${b}` : a)

/**
 * Two panels (docs/design.md): Home, Mixes, Stats, Add music; then Your library, Spotify-like: Songs and your playlists,
 * or every album or artist (kind chips), with covers. The order picked stays (Spotify's sidebar kept going back to
 * Recent: users' first complaint). Settings and Add-ons are in the top bar.
 */
export function Sidebar() {
  const { view, go, tracks, playlists, editPlaylist } = useStore(useShallow((s) => ({ view: s.view, go: s.go, tracks: s.tracks, playlists: s.playlists, editPlaylist: s.editPlaylist })))
  const [kind, setKind] = useState<Kind | null>(null)
  const is = (name: View['name']) => view.name === name
  const hidden = useSettings((s) => s.settings.hiddenPlaylists)
  const order = useSettings((s) => s.settings.playlistOrder)
  const counts = useSettings((s) => s.settings.sidebarCounts)
  const opened = useOpenedLists((s) => s.list)
  const hiddenKeys = useMemo(() => new Set(hidden), [hidden])
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
  const albums = useMemo(() => (kind === 'albums' ? groupAlbums(tracks).sort((a, b) => coll.compare(a.album, b.album)) : []), [kind, tracks])
  const artists = useMemo(() => (kind === 'artists' ? groupArtists(tracks).sort((a, b) => coll.compare(a.artist, b.artist)) : []), [kind, tracks])
  const songs = (n: number) => (counts ? trn(n, '{n} song', '{n} songs') : '')
  const tile = (icon: ReactNode, look: string) => <span className={`grid size-full place-items-center ${look}`}>{icon}</span>

  const entries: Entry[] =
    kind === 'albums'
      ? albums.map((g) => {
          const to: View = { name: 'album', album: g.album, artist: g.artist }
          return { key: `al-${g.album}-${g.artist}`, on: view.name === 'album' && view.album === g.album && view.artist === g.artist, art: <Cover title={g.album} art={trackArt(g.tracks[0])} size={48} className="border-0" />, label: g.album, sub: dot(tr('Album'), g.artist), to, menu: () => navMenu(to, g.tracks) }
        })
      : kind === 'artists'
        ? artists.map((g) => {
            const to: View = { name: 'artist', artist: g.artist }
            return { key: `ar-${g.artist}`, on: view.name === 'artist' && view.artist === g.artist, art: <Cover title={g.artist} art={trackArt(g.cover)} size={48} className="rounded-full! border-0" />, label: g.artist, sub: dot(tr('Artist'), songs(g.count)), round: true, to, menu: () => navMenu(to, g.tracks) }
          })
        : [
            ...(kind ? [] : [{ key: 'songs', on: is('songs'), art: tile(<MusicNotes size={22} weight="fill" />, 'bg-ink text-bg'), label: tr('Songs'), sub: dot(tr('All your songs'), counts ? formatCount(tracks.length) : ''), to: { name: 'songs' } as View, menu: () => navMenu({ name: 'songs' }, useStore.getState().tracks) }]),
            ...shown.map((p) => ({ key: `pl-${p.id}`, on: view.name === 'playlist' && view.id === p.id, art: <PlaylistCover p={p} size={48} big />, label: p.name, sub: dot(tr('Playlist'), songs(p.trackCount)), to: { name: 'playlist', id: p.id } as View, menu: () => playlistMenu(p), playlist: p })),
            ...smart.map((l) => ({ key: `sm-${l.id}`, on: view.name === 'smart' && view.id === l.id, art: tile(<Lightning size={22} weight="fill" />, 'bg-raised text-ink'), label: l.name || tr('Smart playlist'), sub: dot(tr('Smart playlist'), songs(smartSongs.get(l.id)?.length ?? 0)), to: { name: 'smart', id: l.id } as View, menu: () => smartMenu(l, smartSongs.get(l.id) ?? []) })),
          ]

  return (
    <aside className="flex w-66 shrink-0 flex-col gap-2">
      <nav className="flex shrink-0 flex-col rounded-lg bg-panel p-2">
        <NavItem on={is('home')} icon={House} label={tr('Home')} onClick={() => go({ name: 'home' })} onContextMenu={onMenu(() => navMenu({ name: 'home' }))} />
        <NavItem on={is('mixes') || is('mix')} icon={Disc} label={tr('Mixes')} onClick={() => go({ name: 'mixes' })} onContextMenu={onMenu(() => navMenu({ name: 'mixes' }))} />
        <NavItem on={is('stats')} icon={ChartBar} label={tr('Stats')} onClick={() => go({ name: 'stats' })} onContextMenu={onMenu(() => navMenu({ name: 'stats' }))} />
        <NavItem on={is('add')} icon={PlusCircle} label={tr('Add music')} onClick={() => go({ name: 'add' })} onContextMenu={onMenu(() => navMenu({ name: 'add' }))} />
      </nav>

      {/* The mini player stays put at the bottom; only the list scrolls. */}
      <section aria-label={tr('Your library')} className="flex min-h-0 flex-1 flex-col rounded-lg bg-panel">
        <div onContextMenu={onMenu(playlistsMenu)} className="flex shrink-0 items-center gap-1 pt-3 pr-2 pl-4">
          <h2 className="flex-1 text-base font-medium">{tr('Your library')}</h2>
          <RoundButton label={tr('Sort playlists')} kind="plain" size="sm" onClick={(e) => openMenu(e, ORDERS.map((o) => ({ label: tr(o.label), checked: order === o.id, onSelect: () => useSettings.getState().update({ playlistOrder: o.id }) })))}>
            <SortAscending size={18} />
          </RoundButton>
          <RoundButton label={tr('New playlist')} kind="plain" size="sm" onClick={(e) => openMenu(e, [{ label: tr('New playlist'), icon: <Plus size={16} />, onSelect: () => void create() }, { label: tr('New smart playlist'), icon: <Lightning size={16} />, onSelect: createSmart }])}>
            <Plus size={18} />
          </RoundButton>
        </div>
        {/* Fits the panel at the normal text size; bigger text or longer words (other languages) scroll sideways, never cut. */}
        <div role="tablist" aria-label={tr('Show')} className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2">
          {KINDS.map((k) => (
            <button key={k.id} role="tab" aria-selected={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)} className={`shrink-0 rounded-full px-3 py-1 text-[0.8125rem] font-medium whitespace-nowrap transition ${kind === k.id ? 'bg-ink text-bg' : 'bg-raised text-ink hover:bg-line'}`}>
              {tr(k.label)}
            </button>
          ))}
        </div>
        <VirtualList items={entries} rowHeight={64} className="scroll-quiet px-2 pb-2">
          {(e) => <LibItem e={e} />}
        </VirtualList>
        <SidebarPlayer />
      </section>
    </aside>
  )
}

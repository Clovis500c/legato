import { ArrowDownLeft, ArrowUpRight, ChartBar, Disc, FolderSimple, FolderSimpleDashed, FolderSimplePlus, House, Lightning, MagnifyingGlass, MusicNotes, Plus, PlusCircle, PushPin, Radio, SortAscending } from '@phosphor-icons/react'
import { artistName } from '../../shared/artistName'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { playlistKey, type LibraryPlaylist } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatCount } from '../../shared/format'
import { RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { usePhone } from '../../shared/phone'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { VirtualGrid } from '../../shared/ui/VirtualGrid'
import { VirtualList } from '../../shared/ui/VirtualList'
import { DEFAULTS, SIDEBAR_MAX, SIDEBAR_MIN, type PlaylistOrder } from '../../shared/theme/theme'
import { byOpened, useOpenedLists } from '../home/recentLists'
import { PlaylistCover } from '../library/PlaylistCover'
import { canDropOn, dropOn, folderMenu, navMenu, playlistMenu, playlistsMenu } from '../menus'
import { arrange, type PlaylistRow } from './arrange'
import { newFolder, toggleFolder } from './folderActions'
import { useDrag, useDropTarget } from '../../shared/ui/drag'
import { usePlayer } from '../player/store'
import { groupAlbums, groupArtists } from '../library/filter'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { SidebarPlayer } from '../player/SidebarPlayer'
import { newSmartList, smartTracks } from '../smart/rules'
import { saveSmart, smartMenu } from '../smart/actions'

/** Home, Mixes, Stats, Add music: icon Regular at rest, Fill when on (docs/design.md). */
function NavItem({ on, icon: Icon, label, onClick, onContextMenu }: { on: boolean; icon: typeof House; label: string; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button aria-current={on ? 'page' : undefined} onClick={onClick} onContextMenu={onContextMenu} className={`flex h-10 w-full items-center gap-4 rounded-md px-3 text-start phone:h-12 phone:gap-3 text-[0.9375rem] font-medium transition ${on ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
      <Icon key={String(on)} size={22} weight={on ? 'fill' : 'regular'} className={on ? 'icon-in' : ''} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/** One row of Your library: everything it needs to draw and open (a page, or a folder opening and closing). */
interface Entry {
  key: string
  on: boolean
  art: ReactNode
  label: string
  sub: string
  round?: boolean
  to: View | (() => void)
  menu: () => MenuEntry[]
  playlist?: LibraryPlaylist
  /** Inside a folder. */
  depth?: number
  pinned?: boolean
  /** A folder's state. */
  open?: boolean
}

const openEntry = (e: Entry) => (typeof e.to === 'function' ? e.to() : useStore.getState().go(e.to))

/** Your library row: cover, name, kind and count. A playlist takes songs dragged from a list or Up next. */
function LibItem({ e }: { e: Entry }) {
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
    <button aria-current={e.on ? 'page' : undefined} aria-expanded={e.open} onClick={() => openEntry(e)} onContextMenu={onMenu(e.menu)} data-drop={p ? target : undefined} className={`flex h-full w-full items-center gap-3 rounded-md text-start transition ${e.depth ? 'pe-2 ps-6' : 'px-2'} ${e.on || over ? 'bg-raised' : 'hover:bg-raised'} ${over ? 'ring-2 ring-ink' : ''}`}>
      <span className={`grid size-12 shrink-0 place-items-center overflow-hidden ${e.round ? 'rounded-full' : 'rounded-cover'}`}>{e.art}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{e.label}</span>
        <span className="flex items-center gap-1 text-[0.8125rem] text-ink-2">
          {e.pinned && <PushPin size={12} weight="fill" aria-label={tr('Pinned')} className="shrink-0" />}
          <span className="truncate">{e.sub}</span>
        </span>
      </span>
    </button>
  )
}

/** Rare header buttons: drawn under the pointer, on keyboard focus, always where there is no pointer. */
const calm = 'opacity-0 group-hover/lib:opacity-100 focus-visible:opacity-100 group-focus-within/lib:opacity-100 pointer-coarse:opacity-100 phone:opacity-100'

/** Your library open wide: a card per entry, cover above (opening one brings its page back). */
function LibCard({ e }: { e: Entry }) {
  return (
    <button aria-expanded={e.open} onClick={() => openEntry(e)} onContextMenu={onMenu(e.menu)} className="flex w-full flex-col gap-2.5 rounded-lg p-3 text-start transition-colors hover:bg-raised">
      <span className={`grid size-44 place-items-center overflow-hidden ${e.round ? 'rounded-full' : 'rounded-cover'}`}>{e.art}</span>
      <span className="min-w-0">
        <span className="block truncate text-base font-medium">{e.label}</span>
        <span className="flex items-center gap-1 text-[0.8125rem] text-ink-3">
          {e.pinned && <PushPin size={12} weight="fill" aria-label={tr('Pinned')} className="shrink-0" />}
          <span className="truncate">{e.sub}</span>
        </span>
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
  const navOff = useSettings((s) => s.settings.hiddenNav)
  const opened = useOpenedLists((s) => s.list)
  const hiddenKeys = useMemo(() => new Set(hidden), [hidden])
  const shown = useMemo(() => {
    const list = playlists.filter((p) => !hiddenKeys.has(playlistKey(p)))
    if (order === 'name') return [...list].sort((a, b) => coll.compare(a.name, b.name))
    if (order === 'songs') return [...list].sort((a, b) => b.trackCount - a.trackCount)
    return order === 'opened' ? byOpened(list, opened) : list
  }, [playlists, hiddenKeys, order, opened])
  const pinned = useSettings((s) => s.settings.pinnedPlaylists)
  const folders = useSettings((s) => s.settings.playlistFolders)
  const rows = useMemo(() => arrange(shown, playlistKey, pinned, order === 'name' ? [...folders].sort((a, b) => coll.compare(a.name, b.name)) : folders), [shown, pinned, folders, order])
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
  const notFound = useStore((s) => s.notFound.length)
  const stats = useStore((s) => s.stats)
  const smartSongs = useMemo(() => new Map(smart.map((l) => [l.id, smartTracks(l, tracks, stats).map((t) => t.id)])), [smart, tracks, stats])
  const albums = useMemo(() => (kind === 'albums' ? groupAlbums(tracks).sort((a, b) => coll.compare(a.album, b.album)) : []), [kind, tracks])
  const artists = useMemo(() => (kind === 'artists' ? groupArtists(tracks).sort((a, b) => coll.compare(a.artist, b.artist)) : []), [kind, tracks])
  const songs = (n: number) => (counts ? trn(n, '{n} song', '{n} songs') : '')
  const tile = (icon: ReactNode, look: string) => <span className={`grid size-full place-items-center ${look}`}>{icon}</span>
  const update = useSettings((s) => s.update)
  const wide = useSettings((s) => s.settings.libraryWide)
  // Phone layout: open wide, it is the Your library tab (app/PhoneTabs.tsx), a list rather than big covers.
  const phone = usePhone()
  const grid = wide && !phone
  const saved = useSettings((s) => s.settings.sidebarWidth)
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ x: number; w: number } | null>(null)
  const width = drag ?? saved
  const fit = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
  const art = grid ? 176 : 48
  // Open wide, it stands in for the page: whatever opens a page closes it.
  const seen = useRef(view)
  useEffect(() => {
    if (seen.current === view) return
    seen.current = view
    if (useSettings.getState().settings.libraryWide) update({ libraryWide: false })
  }, [view, update])

  const entries: Entry[] =
    kind === 'albums'
      ? albums.map((g) => {
          const to: View = { name: 'album', album: g.album, artist: g.artist }
          return { key: `al-${g.album}-${g.artist}`, on: view.name === 'album' && view.album === g.album && view.artist === g.artist, art: <Cover title={g.album} art={trackArt(g.tracks[0])} size={art} className="border-0" />, label: g.album, sub: dot(tr('Album'), artistName(g.artist)), to, menu: () => navMenu(to, g.tracks) }
        })
      : kind === 'artists'
        ? artists.map((g) => {
            const to: View = { name: 'artist', artist: g.artist }
            return { key: `ar-${g.artist}`, on: view.name === 'artist' && view.artist === g.artist, art: <Cover title={g.artist} art={trackArt(g.cover)} size={art} className="rounded-full! border-0" />, label: artistName(g.artist), sub: dot(tr('Artist'), songs(g.count)), round: true, to, menu: () => navMenu(to, g.tracks) }
          })
        : [
            ...(kind ? [] : [{ key: 'songs', on: is('songs'), art: tile(<MusicNotes size={grid ? 64 : 22} weight="fill" />, 'bg-ink text-bg'), label: tr('Songs'), sub: dot(tr('All your songs'), counts ? formatCount(tracks.length) : ''), to: { name: 'songs' } as View, menu: () => navMenu({ name: 'songs' }, useStore.getState().tracks) }]),
            ...rows.map((r: PlaylistRow<LibraryPlaylist>): Entry => {
              if (r.kind === 'folder') {
                const f = r.folder
                const inside = shown.filter((p) => f.keys.includes(playlistKey(p)))
                const icon = r.count ? <FolderSimple size={grid ? 64 : 22} weight={f.open ? 'regular' : 'fill'} /> : <FolderSimpleDashed size={grid ? 64 : 22} />
                return { key: `fo-${f.id}`, on: false, art: tile(icon, 'bg-raised text-ink'), label: f.name || tr('Folder'), sub: dot(tr('Folder'), trn(r.count, '{n} playlist', '{n} playlists')), to: () => toggleFolder(f.id), open: f.open, menu: () => folderMenu(f, inside) }
              }
              const p = r.p
              return { key: `pl-${p.id}`, on: view.name === 'playlist' && view.id === p.id, art: <PlaylistCover p={p} size={art} big />, label: p.name, sub: dot(tr('Playlist'), songs(p.trackCount)), to: { name: 'playlist', id: p.id }, menu: () => playlistMenu(p), playlist: p, depth: r.depth, pinned: r.pinned }
            }),
            ...smart.map((l) => ({ key: `sm-${l.id}`, on: view.name === 'smart' && view.id === l.id, art: tile(<Lightning size={grid ? 64 : 22} weight="fill" />, 'bg-raised text-ink'), label: l.name || tr('Smart playlist'), sub: dot(tr('Smart playlist'), songs(smartSongs.get(l.id)?.length ?? 0)), to: { name: 'smart', id: l.id } as View, menu: () => smartMenu(l, smartSongs.get(l.id) ?? []) })),
            ...(!kind && notFound ? [{ key: 'not-found', on: is('notFound'), art: tile(<MagnifyingGlass size={grid ? 64 : 22} weight="bold" />, 'bg-raised text-ink-2'), label: tr('Songs not found'), sub: dot(tr('YouTube'), songs(notFound)), to: { name: 'notFound' } as View, menu: () => navMenu({ name: 'notFound' }) }] : []),
          ]

  return (
    <aside className={`relative flex flex-col gap-2 ${wide ? 'min-w-0 flex-1' : 'shrink-0 phone:hidden'}`} style={wide ? undefined : { width }}>
      {/* The phone: Home and Mixes are tabs; Stats and Add music side by side. */}
      <nav className="flex shrink-0 flex-col rounded-lg bg-panel p-2 phone:grid phone:grid-cols-2 phone:gap-1">
        {!phone && !navOff.includes('home') && <NavItem on={is('home')} icon={House} label={tr('Home')} onClick={() => go({ name: 'home' })} onContextMenu={onMenu(() => navMenu({ name: 'home' }))} />}
        {!phone && !navOff.includes('mixes') && <NavItem on={is('mixes') || is('mix')} icon={Disc} label={tr('Mixes')} onClick={() => go({ name: 'mixes' })} onContextMenu={onMenu(() => navMenu({ name: 'mixes' }))} />}
        {!phone && !navOff.includes('radio') && <NavItem on={is('radio')} icon={Radio} label={tr('Radio')} onClick={() => go({ name: 'radio' })} onContextMenu={onMenu(() => navMenu({ name: 'radio' }))} />}
        {!navOff.includes('stats') && <NavItem on={is('stats')} icon={ChartBar} label={tr('Stats')} onClick={() => go({ name: 'stats' })} onContextMenu={onMenu(() => navMenu({ name: 'stats' }))} />}
        {!navOff.includes('add') && <NavItem on={is('add')} icon={PlusCircle} label={tr('Add music')} onClick={() => go({ name: 'add' })} onContextMenu={onMenu(() => navMenu({ name: 'add' }))} />}
      </nav>

      {/* The mini player stays put at the bottom; only the list scrolls. */}
      <section aria-label={tr('Your library')} className="group/lib flex min-h-0 flex-1 flex-col rounded-lg bg-panel">
        <div onContextMenu={onMenu(playlistsMenu)} className="flex shrink-0 items-center gap-1 pt-3 pe-2 ps-4">
          <h2 className="flex-1 text-base font-medium">{tr('Your library')}</h2>
          {/* Expand and Sort under the pointer or the keyboard (a calm sidebar, plan-v2 › U2); open wide and the phone: shown. */}
          <RoundButton label={wide ? tr('Collapse Your library') : tr('Expand Your library')} aria-pressed={wide} kind="plain" size="sm" className={`${wide ? 'nudge-l' : 'nudge-r'} ${wide ? '' : calm} phone:hidden`} onClick={() => update({ libraryWide: !wide })}>
            {wide ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
          </RoundButton>
          <RoundButton label={tr('Sort playlists')} kind="plain" size="sm" className={wide ? '' : calm} onClick={(e) => openMenu(e, ORDERS.map((o) => ({ label: tr(o.label), checked: order === o.id, onSelect: () => useSettings.getState().update({ playlistOrder: o.id }) })))}>
            <SortAscending size={18} />
          </RoundButton>
          <RoundButton label={tr('New playlist')} kind="plain" size="sm" onClick={(e) => openMenu(e, [{ label: tr('New playlist'), icon: <Plus size={16} />, onSelect: () => void create() }, { label: tr('New smart playlist'), icon: <Lightning size={16} />, onSelect: createSmart }, { label: tr('Describe a playlist…'), icon: <MagnifyingGlass size={16} />, onSelect: () => void import('../smart/describeAction').then((m) => m.describeSmart()) }, { label: tr('New folder'), icon: <FolderSimplePlus size={16} />, onSelect: () => void newFolder() }])}>
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
        {grid ? (
          <VirtualGrid items={entries} itemKey={(e) => e.key} render={(e) => <LibCard e={e} />} min={200} gapX={0} gapY={0} className="scroll-quiet px-2 pb-2" />
        ) : (
          <VirtualList items={entries} rowHeight={64} className="scroll-quiet px-2 pb-2">
            {(e) => <LibItem e={e} />}
          </VirtualList>
        )}
        <SidebarPlayer />
      </section>
      {/* Edge: drag (or arrows) to resize, double-click for the default width. */}
      {!wide && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={tr('Resize the sidebar')}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            start.current = { x: e.clientX, w: width }
          }}
          onPointerMove={(e) => start.current && setDrag(fit(start.current.w + e.clientX - start.current.x))}
          onPointerUp={(e) => {
            // From the event: `drag` here can be a move behind.
            if (drag !== null && start.current) update({ sidebarWidth: fit(start.current.w + e.clientX - start.current.x) })
            start.current = null
            setDrag(null)
          }}
          onDoubleClick={() => update({ sidebarWidth: DEFAULTS.sidebarWidth })}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
            if (!step) return
            e.preventDefault()
            update({ sidebarWidth: fit(width + step) })
          }}
          className="absolute inset-y-2 -end-1.5 z-10 w-2 cursor-col-resize rounded-full transition-colors hover:bg-line focus-visible:bg-line"
        />
      )}
    </aside>
  )
}

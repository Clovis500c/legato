import { ArrowUpLeft, ClockCounterClockwise, GlobeSimple, LockSimple, MagnifyingGlass, MicrophoneStage, MusicNotes, Playlist, VinylRecord, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { bindings, comboLabel } from '../../app/keys'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { api, type LibraryPlaylist } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatDuration, region } from '../../shared/format'
import { lang, tr, trn } from '../../shared/i18n/i18n'
import { Cover } from '../../shared/ui/Cover'
import { groupAlbums, groupArtists } from '../library/filter'
import { PlaylistCover } from '../library/PlaylistCover'
import { usePlayer } from '../player/store'
import { clearRecent, forgetRecent, useRecent } from './recent'
import { libraryMatches } from './results'

// Pages that filter their own list as you type.
const FILTERS = ['songs', 'playlist', 'albums', 'artists']

/** The token at the start of the field on a library page: what typing filters. */
function scopeOf(view: View, playlists: LibraryPlaylist[]): { icon: ReactNode; label: string } | null {
  if (view.name === 'songs') return { icon: <MusicNotes size={13} />, label: tr('In Songs') }
  if (view.name === 'albums') return { icon: <VinylRecord size={13} />, label: tr('In Albums') }
  if (view.name === 'artists') return { icon: <MicrophoneStage size={13} />, label: tr('In Artists') }
  if (view.name === 'playlist') return { icon: <Playlist size={13} />, label: tr('In {name}', { name: playlists.find((p) => p.id === view.id)?.name ?? tr('Playlists') }) }
  return null
}

/** One line of the list under the field. */
interface Item {
  key: string
  run: () => void
  node: ReactNode
  /** Second action on the line (remove, fill the field): its own button. */
  side?: ReactNode
}

/** Suggestion with what's typed plain and the rest bold, like YouTube's. */
function Suggested({ s, typed }: { s: string; typed: string }) {
  if (!s.toLowerCase().startsWith(typed.toLowerCase())) return <>{s}</>
  return (
    <>
      {s.slice(0, typed.length)}
      <b className="font-semibold">{s.slice(typed.length)}</b>
    </>
  )
}

/**
 * The only search field, in the top bar (like YouTube's): one pill, its shortcut on keycaps, the mic inside. On a
 * library page a token ("In Songs") says typing filters that list; Backspace removes it and the bar searches everywhere.
 * Focused, a list opens under it without leaving the page: recent searches, then as you type the library's matches,
 * YouTube's suggestions and "Search everywhere" (Enter, the Search page). ↑ ↓ move, Esc closes.
 */
export function SearchBar({ children }: { children?: ReactNode }) {
  const query = useStore((s) => s.query)
  const scoped = useStore((s) => s.scoped)
  const view = useStore((s) => s.view)
  const tracks = useStore((s) => s.tracks)
  const playlists = useStore((s) => s.playlists)
  const { rememberSearches, searchSuggestions, shortcuts } = useSettings((s) => s.settings)
  const recent = useRecent((s) => s.list)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [suggested, setSuggested] = useState<{ q: string; list: string[] }>()
  const input = useRef<HTMLInputElement>(null)

  const scope = scoped && FILTERS.includes(view.name) ? scopeOf(view, playlists) : null
  const text = query.trim()
  const keys = bindings(shortcuts).search.keys?.split('+').map(comboLabel)

  const set = (q: string) => {
    useStore.getState().setQuery(q)
    setOpen(true)
    setActive(-1)
  }
  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const searchFor = (q: string) => {
    close()
    input.current?.blur()
    useStore.getState().searchFor(q.trim())
  }
  // A library pick: go there, the field emptied (its text must not filter the next list).
  const pick = (fn: () => void) => () => {
    close()
    input.current?.blur()
    useStore.getState().setQuery('')
    fn()
  }

  // YouTube's suggestions, asked once typing pauses; a late answer for older text is dropped.
  const wantSuggestions = open && !scope && !!text && searchSuggestions
  useEffect(() => {
    if (!wantSuggestions) return
    let live = true
    const timer = setTimeout(() => {
      api.searchSuggestions(text, lang(), region()).then(
        (list) => live && setSuggested({ q: text, list }),
        () => {},
      )
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [text, wantSuggestions])

  // Artists and albums made once per library, only once the list needs them.
  const wantLibrary = open && !scope && !!text
  const groups = useMemo(() => (wantLibrary ? { artists: groupArtists(tracks), albums: groupAlbums(tracks) } : null), [tracks, wantLibrary])
  const lib = useMemo(() => (groups ? libraryMatches(tracks, playlists, text, groups) : null), [tracks, playlists, text, groups])

  const sections: { label?: ReactNode; items: Item[] }[] = []
  if (!text) {
    if (rememberSearches && recent.length)
      sections.push({
        label: (
          <>
            {tr('Recent searches')}
            <button type="button" onClick={clearRecent} className="font-sans text-xs font-semibold tracking-normal text-accent-ink normal-case hover:underline">
              {tr('Clear all')}
            </button>
          </>
        ),
        items: recent.map((r) => ({
          key: `r:${r}`,
          run: () => searchFor(r),
          node: (
            <>
              <ClockCounterClockwise size={16} className="shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">{r}</span>
            </>
          ),
          side: (
            <button type="button" aria-label={tr('Remove “{q}” from recent searches', { q: r })} title={tr('Remove')} onClick={() => forgetRecent(r)} className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-line hover:text-ink">
              <X size={13} />
            </button>
          ),
        })),
      })
  } else if (lib) {
    const { go } = useStore.getState()
    const items: Item[] = []
    const row = (art: ReactNode, title: string, sub: string, extra?: ReactNode) => (
      <>
        {art}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{title}</span>
          <span className="truncate text-xs text-ink-2">{sub}</span>
        </span>
        {extra}
      </>
    )
    for (const a of lib.artists.slice(0, 1)) items.push({ key: `a:${a.artist}`, run: pick(() => go({ name: 'artist', artist: a.artist })), node: row(<Cover title={a.artist} art={trackArt(a.cover)} size={36} className="rounded-full!" />, a.artist, `${tr('Artist')} · ${trn(a.count, '{n} song', '{n} songs')}`) })
    lib.songs.slice(0, 3).forEach((t, i) => items.push({ key: `s:${t.id}`, run: pick(() => usePlayer.getState().playTracks(lib.songs, i)), node: row(<Cover title={t.album ?? t.title} art={trackArt(t)} size={36} />, t.title, `${tr('Song')} · ${t.artist}`, <span className="font-mono text-[0.6875rem] text-ink-3">{formatDuration(t.durationMs)}</span>) }))
    for (const a of lib.albums.slice(0, 1)) items.push({ key: `b:${a.album}\u0000${a.artist}`, run: pick(() => go({ name: 'album', album: a.album, artist: a.artist })), node: row(<Cover title={a.album} art={trackArt(a.tracks[0])} size={36} />, a.album, `${tr('Album')} · ${a.artist}`) })
    for (const p of lib.playlists.slice(0, 1)) items.push({ key: `p:${p.id}`, run: pick(() => go({ name: 'playlist', id: p.id })), node: row(<PlaylistCover p={p} size={36} />, p.name, `${tr('Playlist')} · ${trn(p.trackCount, '{n} song', '{n} songs')}`) })
    if (items.length) sections.push({ label: tr('In your library'), items })
    const ideas = suggested?.q === text ? suggested.list.filter((s) => s.toLowerCase() !== text.toLowerCase()).slice(0, 4) : []
    if (ideas.length)
      sections.push({
        label: tr('Suggestions'),
        items: ideas.map((s) => ({
          key: `q:${s}`,
          run: () => searchFor(s),
          node: (
            <>
              <MagnifyingGlass size={16} className="shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">
                <Suggested s={s} typed={text} />
              </span>
            </>
          ),
          side: (
            <button type="button" aria-label={tr('Put “{q}” in the search bar', { q: s })} title={tr('Put “{q}” in the search bar', { q: s })} onClick={() => (set(s), input.current?.focus())} className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-line hover:text-ink">
              <ArrowUpLeft size={14} />
            </button>
          ),
        })),
      })
  }
  if (text)
    sections.push({
      items: [
        {
          key: 'everywhere',
          run: () => searchFor(text),
          node: (
            <>
              <GlobeSimple size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{tr('Search everywhere for “{q}”', { q: text })}</span>
              <kbd className="rounded border border-line px-1.5 py-px font-sans text-[0.6875rem] text-ink-3">{tr('Enter')}</kbd>
            </>
          ),
        },
      ],
    })
  const items = sections.flatMap((s) => s.items)
  const shown = open && items.length > 0

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return
      e.preventDefault()
      setOpen(true)
      const d = e.key === 'ArrowDown' ? 1 : -1
      // -1 = the field itself, between the last line and the first.
      setActive((a) => (a + d < -1 ? items.length - 1 : a + d >= items.length ? -1 : a + d))
    } else if (e.key === 'Escape') {
      // List open: close it. Else, as before: empty the field and leave it.
      if (shown) return close()
      useStore.getState().setQuery('')
      e.currentTarget.blur()
    } else if (e.key === 'Backspace' && scope && !query && e.currentTarget.selectionStart === 0) {
      e.preventDefault()
      useStore.getState().setScoped(false)
      setOpen(true)
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (shown && active >= 0) items[active]?.run()
    else if (text) searchFor(text)
  }

  return (
    <form
      role="search"
      onSubmit={submit}
      className="relative flex h-10 w-full max-w-[640px] min-w-0"
    >
      <span className={`flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-full border bg-bg pr-1 pl-4 transition ${focused ? 'border-accent-ink ring-1 ring-accent-ink' : 'border-line hover:border-ink-4'}`}>
        <MagnifyingGlass size={17} className="shrink-0 text-ink-3" aria-hidden />
        {scope && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-raised py-0.5 pr-0.5 pl-2.5 text-xs font-medium">
            <span className="text-accent-ink">{scope.icon}</span>
            {scope.label}
            <button type="button" aria-label={tr('Search everywhere instead (Backspace)')} title={tr('Search everywhere instead (Backspace)')} onClick={() => (useStore.getState().setScoped(false), input.current?.focus())} className="grid size-5 place-items-center rounded-full text-ink-3 hover:bg-line hover:text-ink">
              <X size={10} weight="bold" />
            </button>
          </span>
        )}
        <input
          ref={input}
          data-search
          role="combobox"
          aria-expanded={shown}
          aria-controls="search-list"
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `search-item-${active}` : undefined}
          value={query}
          onChange={(e) => set(e.target.value)}
          onKeyDown={onKey}
          // The list keeps the focus here (its lines don't take it); the mic or a button next to the field closes it.
          onFocus={() => (setFocused(true), setOpen(true))}
          onBlur={() => (setFocused(false), close())}
          placeholder={scope ? tr('Search this list, or press Enter to search everywhere') : tr('Search songs, artists, videos')}
          aria-label={tr('Search')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
        />
        {query && (
          <button type="button" aria-label={tr('Clear search')} title={tr('Clear')} onClick={() => (set(''), input.current?.focus())} className="grid size-7 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-raised hover:text-ink">
            <X size={13} />
          </button>
        )}
        {!focused && !query && keys && (
          <span className="flex shrink-0 gap-1" aria-hidden>
            {keys.map((k) => (
              <kbd key={k} className="rounded border border-line px-1.5 py-px font-sans text-[0.6875rem] font-medium text-ink-3">
                {k}
              </kbd>
            ))}
          </span>
        )}
        <span className="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden />
        {children}
      </span>

      {/* Every button in the list is type="button": a submit one would be what Enter "clicks". */}
      {shown && (
        <div id="search-list" role="listbox" aria-label={tr('Search')} onMouseDown={(e) => e.preventDefault()} className="absolute inset-x-0 top-[calc(100%+6px)] z-50 flex max-h-[min(70vh,560px)] flex-col overflow-y-auto rounded-xl border border-line bg-panel py-2 shadow-[0_12px_32px_var(--shadow)]">
          {sections.map((sec, si) => (
            <div key={si} className={si ? 'mt-1 border-t border-line-soft pt-1' : ''}>
              {sec.label && <p className="kicker flex items-center justify-between px-4 pt-2 pb-1">{sec.label}</p>}
              {sec.items.map((it) => {
                const i = items.indexOf(it)
                return (
                  <div key={it.key} id={`search-item-${i}`} role="option" aria-selected={active === i} onMouseMove={() => active !== i && setActive(i)} onClick={(e) => !(e.target as HTMLElement).closest('button') && it.run()} className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 text-[0.8125rem] ${active === i ? 'bg-raised' : ''}`}>
                    {it.node}
                    {it.side}
                  </div>
                )
              })}
            </div>
          ))}
          <p className="mt-1 flex flex-wrap items-center gap-x-4 border-t border-line-soft px-4 pt-2 text-[0.6875rem] text-ink-3">
            {!text && rememberSearches && recent.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <LockSimple size={12} /> {tr('Kept on this PC only. Turn off in Settings › General.')}
              </span>
            ) : (
              <>
                <span>{tr('↑ ↓ to move')}</span>
                <span>{tr('Enter to open')}</span>
                <span>{tr('Esc to close')}</span>
              </>
            )}
          </p>
        </div>
      )}
    </form>
  )
}

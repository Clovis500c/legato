import { Gear, MagnifyingGlass, MicrophoneStage, MusicNotes, Playlist, Plus, PlusCircle, VinylRecord } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStore, type View } from '../../app/store'
import { formatCount } from '../../shared/format'
import { Led } from '../../shared/ui/controls'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { groupAlbums, groupArtists } from '../library/filter'

function NavItem({ on, icon, label, count, onClick }: { on: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button aria-current={on ? 'page' : undefined} onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2.5 pl-1 text-left transition ${on ? 'bg-raised font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
      <span className="w-1.5">{on && <Led on />}</span>
      <span className={on ? 'text-ink' : 'text-ink-3'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="font-mono text-[10px] text-ink-3">{formatCount(count)}</span>}
    </button>
  )
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-px">
    <h2 className="kicker px-4.5 pb-1.5">{title}</h2>
    {children}
  </section>
)

function Logo() {
  return (
    <span className="relative size-5.5 rounded-full bg-ink">
      <span className="absolute top-1 left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-accent" />
    </span>
  )
}

export function Sidebar() {
  const { view, go, tracks, playlists, status, query, setQuery, editPlaylist } = useStore()
  const counts = useMemo(() => ({ albums: groupAlbums(tracks).length, artists: groupArtists(tracks).length }), [tracks])
  const input = useRef<HTMLInputElement>(null)
  const is = (name: View['name']) => view.name === name
  const inputs = [
    { code: 'YT', on: status.youtube.connected },
    { code: 'SP', on: status.spotify.connected },
    { code: 'AM', on: true },
    { code: 'LOC', on: true },
  ]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <aside className="flex w-63 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-panel px-3 pt-4 pb-3.5">
      <div data-tauri-drag-region className="flex items-center gap-2.5 px-2">
        <Logo />
        <span className="text-[15px] font-bold tracking-tight">Music App</span>
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1.5 focus-within:border-ink-3">
        <MagnifyingGlass size={14} className="text-ink-3" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!['songs', 'playlist', 'album', 'artist'].includes(view.name)) go({ name: 'songs' })
          }}
          placeholder="Search"
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
        />
        <kbd className="font-mono text-[9px] tracking-[0.06em] text-ink-3">CTRL K</kbd>
      </label>

      <NavItem on={is('add')} icon={<PlusCircle size={16} />} label="Add music" onClick={() => go({ name: 'add' })} />

      <Section title="Library">
        <NavItem on={is('songs')} icon={<MusicNotes size={16} />} label="Songs" count={tracks.length} onClick={() => go({ name: 'songs' })} />
        <NavItem on={is('albums') || is('album')} icon={<VinylRecord size={16} />} label="Albums" count={counts.albums} onClick={() => go({ name: 'albums' })} />
        <NavItem on={is('artists') || is('artist')} icon={<MicrophoneStage size={16} />} label="Artists" count={counts.artists} onClick={() => go({ name: 'artists' })} />
      </Section>

      <Section title="Playlists">
        {playlists.map((p) => (
          <NavItem key={p.id} on={view.name === 'playlist' && view.id === p.id} icon={p.custom ? <Playlist size={15} /> : <SourceIcon source={p.source} size={14} />} label={p.name} count={p.trackCount} onClick={() => go({ name: 'playlist', id: p.id })} />
        ))}
        <NavItem
          on={false}
          icon={<Plus size={14} />}
          label="New playlist"
          onClick={async () => {
            const id = await editPlaylist({ type: 'create', name: 'New playlist' })
            if (id !== null) go({ name: 'playlist', id })
          }}
        />
      </Section>

      <div className="flex-1" />

      <button onClick={() => go({ name: 'settings', section: 'sources' })} className="flex flex-col gap-2 rounded-lg border border-line px-4.5 py-2.5 text-left hover:bg-raised" aria-label="Inputs: source status">
        <span className="kicker">Inputs</span>
        <span className="flex gap-3">
          {inputs.map((i) => (
            <span key={i.code} className={`flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] ${i.on ? 'text-ink-2' : 'text-ink-3'}`}>
              <Led on={i.on} /> {i.code}
            </span>
          ))}
        </span>
      </button>
      <NavItem on={is('settings')} icon={<Gear size={16} />} label="Settings" onClick={() => go({ name: 'settings', section: 'appearance' })} />
    </aside>
  )
}

import { AudioLines, Library, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useStore } from '../../app/store'
import type { Source } from '../../shared/api'
import { coverGradient, formatCount } from '../../shared/format'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { libraryStats } from '../library/filter'

const item = 'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface'

function SectionLabel({ children }: { children: string }) {
  return <h2 className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{children}</h2>
}

export function Sidebar() {
  const { view, go, tracks, playlists, status, setFilter } = useStore()
  const perSource = useMemo(() => libraryStats(tracks).perSource, [tracks])
  const connected = (['spotify', 'youtube'] as const).filter((s) => status[s].connected)

  return (
    <aside className="flex w-62 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line-soft bg-panel px-3.5 py-5">
      <div className="flex items-center gap-2.5 px-2">
        <span className="grid size-7.5 place-items-center rounded-[9px] bg-linear-135 from-accent-from to-accent-to">
          <AudioLines size={18} className="text-white" />
        </span>
        <span className="text-base font-bold tracking-tight">Music App</span>
      </div>

      <nav>
        <button
          className={`${item} ${view.name === 'library' ? 'bg-raised font-semibold' : 'text-muted'}`}
          aria-current={view.name === 'library' ? 'page' : undefined}
          onClick={() => {
            setFilter('all')
            go({ name: 'library' })
          }}
        >
          <Library size={18} /> Bibliothèque
        </button>
      </nav>

      <section>
        <SectionLabel>Sources</SectionLabel>
        {connected.map((s: Source) => (
          <button
            key={s}
            className={item}
            onClick={() => {
              setFilter(s)
              go({ name: 'library' })
            }}
          >
            <SourceIcon source={s} />
            <span className="flex-1">{sourceLabel[s]}</span>
            <span className="text-xs text-dim">{formatCount(perSource[s])}</span>
          </button>
        ))}
        <button className={`${item} text-muted`} onClick={() => go({ name: 'sources' })}>
          <Plus size={16} /> {connected.length ? 'Gérer les sources' : 'Ajouter une source'}
        </button>
      </section>

      {playlists.length > 0 && (
        <section className="min-h-0">
          <SectionLabel>Playlists</SectionLabel>
          {playlists.map((p) => (
            <button
              key={p.id}
              className={`${item} py-1.5 ${view.name === 'playlist' && view.id === p.id ? 'bg-raised' : ''}`}
              onClick={() => go({ name: 'playlist', id: p.id })}
            >
              <span className="size-8.5 shrink-0 rounded-md" style={{ background: coverGradient(p.name) }} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{p.name}</span>
                <span className="block truncate text-[11px] text-dim">
                  {sourceLabel[p.source]} · {p.trackCount} titres
                </span>
              </span>
            </button>
          ))}
        </section>
      )}
    </aside>
  )
}

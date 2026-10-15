import { CircleCheck, RefreshCw, Search, Settings, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { LibraryView, PlaylistView } from '../features/library/LibraryView'
import { ConnectWizard } from '../features/sources/ConnectWizard'
import { SourcesView } from '../features/sources/SourcesView'
import { Sidebar } from '../features/sidebar/Sidebar'
import { timeAgo } from '../shared/format'
import { Button } from '../shared/ui/Button'
import { useStore } from './store'

function TopBar() {
  const { query, setQuery, sync, busy, status, lastSync, go, view } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const anyConnected = status.spotify.connected || status.youtube.connected

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
    <div className="flex items-center justify-between gap-4">
      <label className="flex h-10 max-w-110 min-w-40 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 focus-within:border-accent-from">
        <Search size={16} className="text-dim" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (view.name === 'sources') go({ name: 'library' })
          }}
          placeholder="Rechercher dans toutes tes sources"
          aria-label="Rechercher"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
        />
        <kbd className="rounded-[5px] font-sans border border-[#2e2e3a] px-1.5 py-0.5 text-[11px] font-medium text-muted">Ctrl K</kbd>
      </label>
      <div className="flex shrink-0 items-center gap-3">
        {lastSync && (
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted max-xl:hidden">
            {lastSync.report.errors.length ? <TriangleAlert size={14} className="text-local" /> : <CircleCheck size={14} className="text-[#22c55e]" />}
            Synchronisé {timeAgo(lastSync.at)}
          </span>
        )}
        <Button onClick={sync} disabled={busy || !anyConnected} title={anyConnected ? undefined : 'Connecte d’abord une source'}>
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {busy ? 'Synchronisation…' : 'Synchroniser'}
        </Button>
        <Button variant="subtle" className="size-9.5 px-0!" aria-label="Sources et réglages" onClick={() => go({ name: 'sources' })}>
          <Settings size={17} />
        </Button>
      </div>
    </div>
  )
}

function SyncErrors() {
  const { lastSync, error, dismissError, view } = useStore()
  const errors = lastSync?.report.errors ?? []
  // Wizard shows its own error.
  const shown = view.name === 'sources' && view.wizard ? undefined : error
  if (!shown && !errors.length) return null
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] bg-[#2a0f14] px-3.5 py-3 text-xs text-[#fda4af]">
      <TriangleAlert size={15} className="mt-px shrink-0" />
      <div className="flex-1">
        {shown && <p>{shown}</p>}
        {errors.length > 0 && (
          <details>
            <summary className="cursor-pointer">
              {errors.length} erreur{errors.length > 1 ? 's' : ''} pendant la synchronisation
            </summary>
            <ul className="mt-1.5 list-disc pl-4">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {shown && (
        <button aria-label="Masquer" onClick={dismissError}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function App() {
  const { view, go, refresh } = useStore()
  useEffect(() => void refresh(), [refresh])

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-5.5 overflow-hidden px-7 pt-5 pb-3">
        <TopBar />
        <SyncErrors />
        {view.name === 'library' && <LibraryView />}
        {view.name === 'playlist' && <PlaylistView id={view.id} />}
        {view.name === 'sources' && <SourcesView wizard={view.wizard} onSelect={(s) => go({ name: 'sources', wizard: s })} />}
      </main>
      {view.name === 'sources' && view.wizard && <ConnectWizard key={view.wizard} service={view.wizard} onClose={() => go({ name: 'sources' })} />}
    </div>
  )
}

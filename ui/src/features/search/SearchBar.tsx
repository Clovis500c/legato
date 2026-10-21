import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'

// Pages that filter their own list as you type.
const FILTERS = ['songs', 'playlist', 'albums', 'artists']

/**
 * The top bar's search, always there (like YouTube's): typing filters the library page you're on, Enter or the button
 * searches everything (your library, YouTube, YouTube Music, Apple Music) on the Search page. Ctrl+K focuses it.
 */
export function SearchBar({ children }: { children?: React.ReactNode }) {
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const view = useStore((s) => s.view.name)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) useStore.getState().searchFor(query.trim())
  }
  return (
    <form role="search" onSubmit={submit} className="flex h-9 w-full max-w-[600px] min-w-0 items-center gap-2">
      <span className="flex h-full min-w-0 flex-1 items-center rounded-full border border-line bg-bg pr-1 pl-4 focus-within:border-ink-3">
        <input
          data-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
          placeholder={FILTERS.includes(view) ? tr('Search this list, or press Enter to search everywhere') : tr('Search songs, artists, videos')}
          aria-label={tr('Search')}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
        />
        {query && (
          <button type="button" aria-label={tr('Clear search')} title={tr('Clear')} onClick={() => setQuery('')} className="grid size-7 place-items-center rounded-full text-ink-3 hover:bg-raised hover:text-ink">
            <X size={13} />
          </button>
        )}
        <kbd className="mr-2 font-mono text-[9px] tracking-[0.06em] text-ink-3">CTRL K</kbd>
        <button type="submit" aria-label={tr('Search everywhere')} title={tr('Search everywhere')} className="-mr-1 grid h-9 w-14 place-items-center rounded-r-full border-l border-line bg-raised text-ink-2 hover:text-ink">
          <MagnifyingGlass size={16} />
        </button>
      </span>
      {children}
    </form>
  )
}

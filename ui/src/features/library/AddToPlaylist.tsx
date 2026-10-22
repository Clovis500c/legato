import { ListPlus, Plus } from '@phosphor-icons/react'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { RoundButton } from '../../shared/ui/controls'
import { addToPlaylist } from './edits'
import { tr } from '../../shared/i18n/i18n'

/**
 * Row action: pick a custom playlist (or create one) for these tracks. Fixed menu so the list scroller can't clip it.
 * `trackIds` may be a function: tracks not in the library yet get added once a playlist is picked.
 */
export function AddToPlaylist({ trackIds, label }: { trackIds: number[] | (() => Promise<number[]>); label: string }) {
  const { playlists, editPlaylist } = useStore()
  const [at, setAt] = useState<DOMRect | null>(null)
  const custom = playlists.filter((p) => p.custom)
  const add = async (id: number | null) => {
    setAt(null)
    const target = id ?? (await editPlaylist({ type: 'create', name: tr('New playlist') }))
    if (target !== null) await addToPlaylist(target, typeof trackIds === 'function' ? await trackIds() : trackIds)
  }
  return (
    <>
      <RoundButton label={label} kind="plain" size="xs" onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())}>
        <ListPlus size={14} />
      </RoundButton>
      {at && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAt(null)} />
          <div role="menu" className="fixed z-50 flex w-56 flex-col rounded-lg border border-line bg-raised p-1 shadow-[0_12px_32px_var(--shadow)]" style={{ top: Math.min(at.bottom + 4, window.innerHeight - 260), left: at.right - 224 }}>
            <p className="kicker px-2.5 py-1.5">{tr('Add to')}</p>
            <div className="max-h-48 overflow-y-auto">
              {custom.map((p) => (
                <button key={p.id} role="menuitem" onClick={() => add(p.id)} className="w-full truncate rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] hover:bg-bg">
                  {p.name}
                </button>
              ))}
            </div>
            <button role="menuitem" onClick={() => add(null)} className="flex items-center gap-2 rounded-md border-t border-line-soft px-2.5 py-1.5 text-left text-[0.8125rem] font-medium hover:bg-bg">
              <Plus size={12} /> {tr('New playlist')}
            </button>
          </div>
        </>
      )}
    </>
  )
}

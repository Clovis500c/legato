import { useState } from 'react'
import type { SpotifyList, SpotifyPick } from '../../shared/api'
import { remoteArt } from '../../shared/art'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'

/** A service's lists read from its page, all ticked: the ones to import (Connect Spotify, Connect Apple Music). */
export function ListPick({ title, lists, onClose, onStart }: { title: string; lists: SpotifyList[]; onClose: () => void; onStart: (picks: SpotifyPick[]) => void }) {
  const [off, setOff] = useState<string[]>([])
  const ticked = lists.filter((l) => !off.includes(l.id))
  return (
    <Dialog title={title} onClose={onClose}>
      <ul className="flex max-h-80 flex-col overflow-y-auto">
        {lists.map((l) => (
          <li key={l.id}>
            <label className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-raised">
              <input type="checkbox" className="size-3.5 accent-ink" checked={!off.includes(l.id)} onChange={(e) => setOff(e.target.checked ? off.filter((id) => id !== l.id) : [...off, l.id])} />
              <Cover title={l.name} art={l.cover ? [remoteArt(l.cover)] : []} size={32} />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{l.name}</span>
              {l.songs !== null && <span className="text-xs text-ink-3">{trn(l.songs, '{n} song', '{n} songs')}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setOff(ticked.length ? lists.map((l) => l.id) : [])}>
          {ticked.length ? tr('Clear selection') : tr('Select all')}
        </Button>
        <Button disabled={!ticked.length} onClick={() => onStart(ticked.map((l) => ({ id: l.id, name: l.name })))}>
          {trn(ticked.length, 'Import {n} list', 'Import {n} lists')}
        </Button>
      </div>
    </Dialog>
  )
}

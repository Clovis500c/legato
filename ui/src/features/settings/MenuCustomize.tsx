import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { useState } from 'react'
import { useSettings } from '../../app/settings'
import { msg, tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Segmented } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { foldedBy, moveItem, orderedDefs, resetKind, toggleItem, type MenuKind } from '../../shared/ui/menuShape'

/** The kinds of right-click menu that have items to choose (album and artist pages use the songs' menu). */
const KINDS: [MenuKind, string][] = [
  ['track', msg('Songs')],
  ['tracks', msg('Lists of songs')],
  ['playlist', msg('Playlists')],
  ['folder', msg('Folders')],
  ['queue', msg('Up next')],
  ['player', msg('Player')],
  ['nav', msg('Sidebar')],
  ['app', msg('Elsewhere in the app')],
]

/**
 * Settings › Appearance › Right-click menus › Customize (loaded when opened, not at launch): per kind of menu, tick what
 * it shows and move items up or down (buttons: the keyboard reaches them). The preset above it works live; "Reset" puts
 * one kind back. Hiding an item never removes it from the app: a menu that would come out empty shows as built.
 */
export default function MenuCustomize({ onClose }: { onClose: () => void }) {
  const layout = useSettings((s) => s.settings.menuLayout)
  const update = useSettings((s) => s.update)
  const [kind, setKind] = useState<MenuKind>('track')
  const set = (next: typeof layout) => update({ menuLayout: next })
  const rows = orderedDefs(kind, layout)
  const hidden = layout.hidden[kind] ?? []
  const touched = hidden.length > 0 || (layout.order[kind]?.length ?? 0) > 0
  return (
    <Dialog title={tr('Right-click menus')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ink-2">{tr('Tick what each right-click menu shows and move items up or down. Items a menu leaves out stay in the app. If everything is hidden, the menu shows as built.')}</p>
        <Segmented
          label={tr('Right-click menus')}
          value={layout.preset}
          onChange={(preset) => set({ ...layout, preset })}
          options={[
            { value: 'essentials', label: tr('Essentials') },
            { value: 'standard', label: tr('Standard') },
            { value: 'full', label: tr('Full detail') },
          ]}
        />
        <select aria-label={tr('Menu')} value={kind} onChange={(e) => setKind(e.target.value as MenuKind)} className="h-8 w-fit max-w-full rounded-md border border-line bg-bg px-2 text-[0.8125rem]">
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
        <ul className="flex max-h-[50vh] flex-col overflow-y-auto rounded-lg border border-line">
          {rows.map((d, i) => {
            const off = hidden.includes(d.id)
            return (
              <li key={d.id} className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5 last:border-b-0">
                <label className={`flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] ${off ? 'text-ink-3' : ''}`}>
                  <input type="checkbox" checked={!off} onChange={() => set(toggleItem(layout, kind, d.id))} className="size-4 shrink-0 accent-[var(--accent)]" />
                  <span className="truncate">{tr(d.label)}</span>
                  {!off && foldedBy(layout.preset, d) && <span className="shrink-0 text-[0.6875rem] text-ink-3">{tr('Under More…')}</span>}
                </label>
                <button type="button" aria-label={tr('Move up')} disabled={i === 0} onClick={() => set(moveItem(layout, kind, d.id, -1))} className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-line-soft disabled:opacity-30">
                  <ArrowUp size={14} />
                </button>
                <button type="button" aria-label={tr('Move down')} disabled={i === rows.length - 1} onClick={() => set(moveItem(layout, kind, d.id, 1))} className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-line-soft disabled:opacity-30">
                  <ArrowDown size={14} />
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" disabled={!touched} onClick={() => set(resetKind(layout, kind))}>
            {tr('Reset')}
          </Button>
          <Button onClick={onClose}>{tr('Done')}</Button>
        </div>
      </div>
    </Dialog>
  )
}

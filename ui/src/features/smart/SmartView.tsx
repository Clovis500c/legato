import { DotsThree, Lightning, ListPlus, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { useMemo, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type Source } from '../../shared/api'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { ask } from '../../shared/ui/Ask'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { RoundButton, Segmented } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SMART_FIELDS, type SmartField, type SmartList, type SmartRule } from '../../shared/theme/theme'
import { tracksMenu } from '../menus'
import { PlayAll, ShuffleRound, totalTime } from '../library/LibraryView'
import { TrackTable } from '../library/TrackTable'
import { smartTracks } from './rules'

const FIELD_LABEL: Record<SmartField, string> = { artist: msg('Artist'), album: msg('Album'), title: msg('Title'), source: msg('Source'), plays: msg('Plays'), played: msg('Last played'), added: msg('Added') }
const OPS: Record<SmartField, { value: string; label: string }[]> = {
  artist: [{ value: 'has', label: msg('contains') }, { value: 'is', label: msg('is') }, { value: 'not', label: msg('doesn’t contain') }],
  album: [{ value: 'has', label: msg('contains') }, { value: 'is', label: msg('is') }, { value: 'not', label: msg('doesn’t contain') }],
  title: [{ value: 'has', label: msg('contains') }, { value: 'is', label: msg('is') }, { value: 'not', label: msg('doesn’t contain') }],
  source: [{ value: 'is', label: msg('is') }, { value: 'not', label: msg('isn’t') }],
  plays: [{ value: 'atLeast', label: msg('at least') }, { value: 'atMost', label: msg('at most') }],
  played: [{ value: 'within', label: msg('in the last (days)') }, { value: 'notWithin', label: msg('not in the last (days)') }],
  added: [{ value: 'last', label: msg('among the newest') }],
}
const SOURCES: { value: Source; label: string }[] = [{ value: 'youtube', label: msg('YouTube') }, { value: 'spotify', label: msg('Spotify') }, { value: 'apple', label: msg('Apple Music') }, { value: 'local', label: msg('Local files') }]
const SORT_LABEL: Record<SmartList['sort'], string> = { plays: msg('Most played'), recent: msg('Recently played'), added: msg('Recently added'), title: msg('Title'), artist: msg('Artist'), random: msg('Random') }
const DEFAULT_RULE: Record<SmartField, SmartRule> = {
  artist: { field: 'artist', op: 'has', value: '' },
  album: { field: 'album', op: 'has', value: '' },
  title: { field: 'title', op: 'has', value: '' },
  source: { field: 'source', op: 'is', value: 'youtube' },
  plays: { field: 'plays', op: 'atLeast', value: '5' },
  played: { field: 'played', op: 'within', value: '30' },
  added: { field: 'added', op: 'last', value: '50' },
}

const field = 'h-8 rounded-md border border-line bg-bg px-2 text-[0.8125rem]'

export function useSmartList(id: string) {
  return useSettings((s) => s.settings.smartLists.find((l) => l.id === id))
}

export function saveSmart(list: SmartList) {
  const all = useSettings.getState().settings.smartLists
  useSettings.getState().update({ smartLists: all.some((l) => l.id === list.id) ? all.map((l) => (l.id === list.id ? list : l)) : [...all, list] })
}

export async function deleteSmart(list: SmartList) {
  if (!(await ask({ title: tr('Delete “{name}”?', { name: list.name }), body: tr('Only the rules go: your songs stay in the library.'), ok: tr('Delete') }))) return
  useSettings.getState().update({ smartLists: useSettings.getState().settings.smartLists.filter((l) => l.id !== list.id) })
  const v = useStore.getState().view
  if (v.name === 'smart' && v.id === list.id) useStore.getState().go({ name: 'home' })
}

/** Today's songs copied into a normal playlist (which then stays as it is). */
async function saveAsPlaylist(list: SmartList, ids: number[]) {
  const { refreshChanged, notify, go } = useStore.getState()
  try {
    const id = await api.editPlaylist({ type: 'create', name: list.name })
    if (id === null) return
    if (ids.length) await api.editPlaylist({ type: 'add', id, trackIds: ids })
    await refreshChanged()
    notify(tr('Saved as the playlist “{name}”', { name: list.name }), { action: { label: tr('Open'), run: () => go({ name: 'playlist', id }) } })
  } catch (e) {
    notify(String(e), { kind: 'error' })
  }
}

export function smartMenu(list: SmartList, ids: number[], edit?: () => void): MenuEntry[] {
  return [
    edit && { label: tr('Edit rules'), icon: <PencilSimple size={16} />, onSelect: edit },
    { label: tr('Save as a playlist'), icon: <ListPlus size={16} />, onSelect: () => void saveAsPlaylist(list, ids) },
    '-',
    { label: tr('Delete'), icon: <Trash size={16} />, danger: true, onSelect: () => void deleteSmart(list) },
  ]
}

function RuleRow({ rule, onChange, onRemove }: { rule: SmartRule; onChange: (r: SmartRule) => void; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <select aria-label={tr('Field')} value={rule.field} onChange={(e) => onChange(DEFAULT_RULE[e.target.value as SmartField])} className={field}>
        {SMART_FIELDS.map((f) => (
          <option key={f} value={f}>
            {tr(FIELD_LABEL[f])}
          </option>
        ))}
      </select>
      <select aria-label={tr('Test')} value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value })} className={field}>
        {OPS[rule.field].map((o) => (
          <option key={o.value} value={o.value}>
            {tr(o.label)}
          </option>
        ))}
      </select>
      {rule.field === 'source' ? (
        <select aria-label={tr('Value')} value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} className={field}>
          {SOURCES.map((o) => (
            <option key={o.value} value={o.value}>
              {tr(o.label)}
            </option>
          ))}
        </select>
      ) : (
        <input aria-label={tr('Value')} value={rule.value} inputMode={['plays', 'played', 'added'].includes(rule.field) ? 'numeric' : undefined} onChange={(e) => onChange({ ...rule, value: e.target.value })} className={`${field} w-48`} />
      )}
      <RoundButton label={tr('Remove this rule')} kind="plain" size="xs" onClick={onRemove}>
        <X size={13} />
      </RoundButton>
    </li>
  )
}

function Editor({ list }: { list: SmartList }) {
  const set = (patch: Partial<SmartList>) => saveSmart({ ...list, ...patch })
  return (
    <div className="mb-5 flex flex-col gap-4 rounded-xl border border-line bg-raised p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-2">{tr('Name')}</span>
        <input value={list.name} onChange={(e) => set({ name: e.target.value })} className={`${field} w-80`} />
      </label>
      <div className="flex items-center gap-3 text-[0.8125rem]">
        <span>{tr('Songs that match')}</span>
        <Segmented label={tr('Match')} value={list.match} onChange={(match) => set({ match })} options={[{ value: 'all', label: tr('every rule') }, { value: 'any', label: tr('any rule') }]} />
      </div>
      <ul className="flex flex-col gap-2">
        {list.rules.map((r, i) => (
          <RuleRow key={i} rule={r} onChange={(nr) => set({ rules: list.rules.map((x, j) => (j === i ? nr : x)) })} onRemove={() => set({ rules: list.rules.filter((_, j) => j !== i) })} />
        ))}
      </ul>
      <Button variant="ghost" className="w-fit" onClick={() => set({ rules: [...list.rules, DEFAULT_RULE.artist] })}>
        <Plus size={14} /> {tr('Add a rule')}
      </Button>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-3 text-[0.8125rem]">
        <span>{tr('Sort by')}</span>
        <select aria-label={tr('Sort by')} value={list.sort} onChange={(e) => set({ sort: e.target.value as SmartList['sort'] })} className={field}>
          {(Object.keys(SORT_LABEL) as SmartList['sort'][]).map((s) => (
            <option key={s} value={s}>
              {tr(SORT_LABEL[s])}
            </option>
          ))}
        </select>
        <span>{tr('Songs at most (0 = all)')}</span>
        <input aria-label={tr('Songs at most (0 = all)')} inputMode="numeric" value={list.limit} onChange={(e) => set({ limit: Math.max(0, Math.min(10_000, Number(e.target.value.replace(/\D/g, '')) || 0)) })} className={`${field} w-20`} />
      </div>
    </div>
  )
}

/** A smart playlist: its songs today, from its rules; the rules edited in place (saved as you type). */
export function SmartView({ id }: { id: string }) {
  const list = useSmartList(id)
  const { tracks, stats } = useStore(useShallow(({ tracks, stats }) => ({ tracks, stats })))
  const [editing, setEditing] = useState(false)
  const songs = useMemo(() => (list ? smartTracks(list, tracks, stats) : []), [list, tracks, stats])
  if (!list) return <p className="py-16 text-center text-ink-3">{tr('This smart playlist was deleted.')}</p>
  const ids = songs.map((t) => t.id)
  const edit = () => setEditing((e) => !e)
  return (
    <>
      <PageHeader
        onContextMenu={onMenu(() => [...smartMenu(list, ids, edit), '-', ...tracksMenu(songs)])}
        kicker={tr('Smart playlist')}
        title={
          <span className="flex items-center gap-3">
            <Lightning size={26} weight="fill" className="text-accent-ink" /> {list.name || tr('Smart playlist')}
          </span>
        }
        sub={`${trn(songs.length, '{n} song', '{n} songs')} · ${totalTime(songs)} · ${tr('Updates by itself as you add and play songs')}`}
        actions={
          <>
            <PlayAll tracks={songs} />
            <ShuffleRound tracks={songs} />
            <Button variant={editing ? 'accent' : 'ghost'} onClick={edit}>
              <PencilSimple size={15} /> {editing ? tr('Done') : tr('Edit rules')}
            </Button>
            <RoundButton label={tr('More')} kind="plain" onClick={(e) => openMenu(e, smartMenu(list, ids))}>
              <DotsThree size={20} weight="bold" />
            </RoundButton>
          </>
        }
      />
      {editing && <Editor list={list} />}
      <TrackTable tracks={songs} empty={tr('No song matches these rules yet.')} />
    </>
  )
}

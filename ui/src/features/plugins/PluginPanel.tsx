import { useEffect, useState } from 'react'
import { artistName } from '../../shared/artistName'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Toggle } from '../../shared/ui/controls'
import { usePlayer } from '../player/store'
import { usePlugins } from './host'
import type { PanelNode } from './panel'

const send = (plugin: string, id: string, value: unknown) => void api.pluginInput(plugin, 'panel', { id, value }).catch(() => {})

/** Text field sent when done (Enter or leaving it), not on every key. */
function Field({ plugin, node }: { plugin: string; node: Extract<PanelNode, { type: 'input' }> }) {
  const [v, setV] = useState(node.value)
  useEffect(() => setV(node.value), [node.value])
  return <input aria-label={node.label} placeholder={node.label} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== node.value && send(plugin, node.id, v)} onKeyDown={(e) => e.key === 'Enter' && send(plugin, node.id, v)} className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[0.8125rem] outline-none focus:border-ink-3" />
}

function Tracks({ ids }: { ids: number[] }) {
  const tracks = useStore((s) => s.tracks)
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const list = ids.map((i) => byId.get(i)).filter((t) => !!t)
  return (
    <ol className="flex flex-col">
      {list.map((t, i) => (
        <li key={t.id}>
          <button onClick={() => usePlayer.getState().playTracks(list, i)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[0.8125rem] hover:bg-raised">
            <span className="w-5 text-right font-mono text-[0.6875rem] text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <span className="max-w-[40%] truncate text-xs text-ink-2">{artistName(t.artist)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function Node({ plugin, node }: { plugin: string; node: PanelNode }) {
  switch (node.type) {
    case 'heading':
      return <h3 className="text-[0.875rem] font-semibold">{node.text}</h3>
    case 'text':
      return <p className={`text-[0.8125rem] whitespace-pre-line ${node.muted ? 'text-ink-2' : ''}`}>{node.text}</p>
    case 'button':
      return (
        <Button variant={node.primary ? 'primary' : 'ghost'} onClick={() => send(plugin, node.id, null)}>
          {node.label}
        </Button>
      )
    case 'toggle':
      return (
        <label className="flex items-center justify-between gap-3 text-[0.8125rem]">
          {node.label}
          <Toggle label={node.label} checked={node.value} onChange={(v) => send(plugin, node.id, v)} />
        </label>
      )
    case 'slider':
      return (
        <label className="flex items-center gap-3 text-[0.8125rem]">
          <span className="w-32 shrink-0 truncate text-ink-2">{node.label}</span>
          <input type="range" aria-label={node.label} min={node.min} max={node.max} step={node.step || 'any'} defaultValue={node.value} key={node.value} onChange={(e) => send(plugin, node.id, +e.target.value)} className="bar flex-1" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${((node.value - node.min) / (node.max - node.min || 1)) * 100}%, var(--line) 0)` }} />
          <span className="w-12 text-right font-mono text-xs tabular-nums">{node.value}</span>
        </label>
      )
    case 'input':
      return (
        <label className="flex items-center gap-3 text-[0.8125rem]">
          <span className="w-32 shrink-0 truncate text-ink-2">{node.label}</span>
          <Field plugin={plugin} node={node} />
        </label>
      )
    case 'select':
      return (
        <label className="flex items-center gap-3 text-[0.8125rem]">
          <span className="w-32 shrink-0 truncate text-ink-2">{node.label}</span>
          <select aria-label={node.label} value={node.value} onChange={(e) => send(plugin, node.id, e.target.value)} className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-[0.8125rem]">
            {node.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )
    case 'tracks':
      return <Tracks ids={node.ids} />
    case 'row':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {node.children.map((c, i) => (
            <Node key={i} plugin={plugin} node={c} />
          ))}
        </div>
      )
    case 'divider':
      return <hr className="border-line-soft" />
  }
}

/** A plugin's panel: parts the app draws from the plugin's data (no markup from the plugin). */
export function PluginPanel({ plugin }: { plugin: string }) {
  const tree = usePlugins((s) => s.panels[plugin])
  if (!tree?.length) return <p className="text-sm text-ink-2">{tr('This plugin has no panel.')}</p>
  return (
    <div className="flex flex-col gap-3">
      {tree.map((n, i) => (
        <Node key={i} plugin={plugin} node={n} />
      ))}
    </div>
  )
}

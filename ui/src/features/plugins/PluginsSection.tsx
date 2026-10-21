import { FolderOpen, Gear, Info, PuzzlePiece, Warning, WarningCircle } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type PluginInfo, type PluginInspect } from '../../shared/api'
import { formatBytes } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton, Toggle } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { pluginMenu } from '../menus'
import { loadPlugins, permissionText, usePlugins } from './host'
import { PluginPanel } from './PluginPanel'

const fail = (e: unknown) => useStore.getState().notify(String(e), { kind: 'error' })

function Permissions({ list, fresh }: { list: string[]; fresh?: string[] }) {
  if (!list.length) return <p className="text-[13px] text-ink-2">{tr('Nothing beyond its own storage.')}</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((p) => {
        const { text, risky } = permissionText(p)
        return (
          <li key={p} className="flex items-start gap-2 text-[13px]">
            {risky ? <Warning size={15} className="mt-0.5 shrink-0 text-[#F0B232]" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-3" />}
            <span>
              {text}
              {fresh?.includes(p) && <span className="ml-1.5 rounded-full border border-line px-1.5 text-[10px] text-ink-2">{tr('New')}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Before installing: who made it, what it can do. Nothing is copied or run until the user agrees. */
function Approve({ folder, onClose }: { folder: string; onClose: () => void }) {
  const [info, setInfo] = useState<PluginInspect>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api
      .pluginInspect(folder)
      .then(setInfo)
      .catch((e) => setError(String(e)))
  }, [folder])
  const install = async () => {
    setBusy(true)
    try {
      await api.pluginInstall(folder)
      await loadPlugins()
      useStore.getState().notify(tr('{name} installed and turned on', { name: info!.manifest.name }), { kind: 'ok' })
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const m = info?.manifest
  return (
    <Dialog title={m ? m.name : tr('Install a plugin')} kicker={m ? (info.installed ? tr('Update {from} → {to}', { from: info.installed, to: m.version }) : tr('Plugin · version {version}', { version: m.version })) : undefined} onClose={onClose}>
      {!info && !error && <p className="text-sm text-ink-2">{tr('Reading the plugin…')}</p>}
      {m && (
        <>
          <p className="text-[13px] text-ink-2">{m.description || tr('No description.')}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-2">
            <WarningCircle size={14} /> {tr('By {author} · not checked by the app’s developer', { author: m.author })}
          </p>
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">{tr('It will be able to:')}</h3>
            <Permissions list={m.permissions} fresh={info.installed ? info.newPermissions : undefined} />
          </section>
          <p className="text-xs text-ink-3">{tr('It runs apart from the app: no access to your files, passwords or accounts, and no internet except the sites listed. {files} files, {size}.', { files: info.files, size: formatBytes(info.size) })}</p>
        </>
      )}
      {error && <p className="text-sm text-[#F23F43]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tr('Cancel')}
        </Button>
        <Button disabled={!m || busy} onClick={() => void install()}>
          {info?.installed ? tr('Update') : tr('Install')}
        </Button>
      </div>
    </Dialog>
  )
}

function About({ p, onClose }: { p: PluginInfo; onClose: () => void }) {
  const [log, setLog] = useState<string[]>([])
  useEffect(() => {
    const read = () => void api.pluginLog(p.id).then(setLog).catch(() => {})
    read()
    const id = setInterval(read, 2000)
    return () => clearInterval(id)
  }, [p.id])
  const m = p.manifest
  return (
    <Dialog title={m?.name ?? p.id} kicker={tr('Plugin')} onClose={onClose}>
      {m && (
        <>
          <p className="text-[13px] text-ink-2">{m.description}</p>
          <p className="text-xs text-ink-2">{tr('Version {version} · by {author} · plugin API {api}', { version: m.version, author: m.author, api: m.api })}</p>
          {m.homepage && (
            <Button variant="link" className="w-fit text-xs" onClick={() => void openUrl(m.homepage!).catch(fail)}>
              {m.homepage}
            </Button>
          )}
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">{tr('Allowed to:')}</h3>
            <Permissions list={p.granted} />
          </section>
        </>
      )}
      {p.error && <p className="text-xs text-[#F23F43]">{p.error}</p>}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[13px] font-semibold">{tr('Log')}</h3>
        <pre className="max-h-48 overflow-auto rounded-md bg-recess p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2">{log.length ? log.join('\n') : tr('Nothing yet.')}</pre>
      </section>
      <p className="text-[11px] break-all text-ink-3">{p.folder}</p>
    </Dialog>
  )
}

function Card({ p, onPanel, onAbout }: { p: PluginInfo; onPanel: () => void; onAbout: () => void }) {
  const hasPanel = usePlugins((s) => !!s.panels[p.id]?.length)
  const name = p.manifest?.name ?? p.id
  return (
    <article onContextMenu={onMenu(() => pluginMenu(p, onAbout))} className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-4">
      <div className="flex items-center gap-2">
        <PuzzlePiece size={16} className="text-ink-3" />
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{name}</h3>
        {hasPanel && (
          <RoundButton label={tr('{name} settings', { name })} kind="plain" size="xs" onClick={onPanel}>
            <Gear size={16} />
          </RoundButton>
        )}
        <RoundButton label={tr('About {name}', { name })} kind="plain" size="xs" onClick={onAbout}>
          <Info size={16} />
        </RoundButton>
        <Toggle label={tr('Turn on {name}', { name })} checked={p.on} onChange={(on) => void api.pluginSet(p.id, on).then(loadPlugins).catch(fail)} />
      </div>
      <p className="text-xs leading-relaxed text-ink-2">{p.manifest?.description}</p>
      {p.error && <p className="text-xs text-[#F23F43]">{p.error}</p>}
      <footer className="mt-auto flex items-center gap-2 border-t border-line-soft pt-2.5 text-[11px] text-ink-3">
        <WarningCircle size={14} /> {p.manifest ? `${p.manifest.author} · ${tr('Not verified')}` : tr('Not verified')}
        <span className="flex-1" />
        {p.manifest && <span>v{p.manifest.version}</span>}
      </footer>
    </article>
  )
}

/** Add-ons › Plugins: third-party plugins installed from a folder. */
export function PluginsSection({ query }: { query: string }) {
  const list = usePlugins((s) => s.list)
  const [installing, setInstalling] = useState<string | null>(null)
  const [panel, setPanel] = useState<PluginInfo | null>(null)
  const [about, setAbout] = useState<PluginInfo | null>(null)
  useEffect(() => void loadPlugins(), [])
  const q = query.trim().toLowerCase()
  const shown = list.filter((p) => !q || `${p.manifest?.name} ${p.manifest?.description} ${p.manifest?.author}`.toLowerCase().includes(q))
  const pick = async () => {
    const dir = await open({ directory: true, title: tr('The plugin’s folder (with plugin.json)') })
    if (typeof dir === 'string') setInstalling(dir)
  }
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 className="kicker flex-1">{tr('Plugins')}</h2>
        <Button variant="ghost" onClick={() => void pick()}>
          <FolderOpen size={14} /> {tr('Install a plugin…')}
        </Button>
      </div>
      {shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {shown.map((p) => (
            <Card key={p.id} p={p} onPanel={() => setPanel(p)} onAbout={() => setAbout(p)} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">{list.length ? tr('No plugin matches.') : tr('Plugins made by others add features. Each asks before it can do anything, and runs apart from the app. How to write one: docs/plugins.md.')}</p>
      )}
      {installing && <Approve folder={installing} onClose={() => setInstalling(null)} />}
      {panel && (
        <Dialog title={panel.manifest?.name ?? panel.id} kicker={tr('Plugin')} onClose={() => setPanel(null)}>
          <PluginPanel plugin={panel.id} />
        </Dialog>
      )}
      {about && <About p={about} onClose={() => setAbout(null)} />}
    </section>
  )
}

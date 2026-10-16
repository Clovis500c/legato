import { FolderPlus, HardDrives, ShieldCheck, X } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type Service } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton } from '../../shared/ui/controls'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'

function ServiceRow({ service }: { service: Service }) {
  const { status, disconnect, busy, go, view } = useStore()
  const { connected } = status[service]
  const selected = view.name === 'settings' && view.wizard === service
  return (
    <div className={`flex items-center gap-4 border-b border-line-soft px-4 py-3.5 ${selected ? 'bg-bg' : ''}`}>
      <Led on={connected} />
      <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
        <SourceIcon source={service} size={16} />
      </span>
      <div className="flex-1">
        <p className="text-[13px] font-semibold">{sourceLabel[service]}</p>
        <p className="text-xs text-ink-2">{guides[service].pitch}</p>
      </div>
      <span className="kicker">{connected ? 'Connecté' : 'Non connecté'}</span>
      {connected ? (
        <Button variant="ghost" disabled={busy} onClick={() => disconnect(service)}>
          Déconnecter
        </Button>
      ) : (
        <Button onClick={() => go({ name: 'settings', section: 'sources', wizard: service })}>Connecter</Button>
      )}
    </div>
  )
}

/** Music folders: scanned with tags, linked to tracks already known from other services. */
function LocalFolders() {
  const { refresh, tracks } = useStore()
  const [folders, setFolders] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const files = tracks.filter((t) => t.ids.local).length
  useEffect(() => void api.localFolders().then(setFolders), [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setFolders(await api.localFolders())
      await refresh()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    const dir = await open({ directory: true, title: 'Dossier de musique' })
    if (typeof dir === 'string' && !folders.includes(dir)) await run(() => api.setLocalFolders([...folders, dir]))
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-4">
        <Led on={folders.length > 0} />
        <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
          <HardDrives size={16} />
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold">Fichiers locaux</p>
          <p className="text-xs text-ink-2">MP3, FLAC, WAV, OGG, M4A. Reliés à tes titres YouTube et Spotify, et lus en priorité, sans blanc entre les titres.</p>
        </div>
        <span className="kicker">{busy ? 'Analyse…' : `${formatCount(files)} fichiers`}</span>
      </div>
      {folders.length > 0 && (
        <ul className="ml-13 flex flex-col rounded-lg border border-line-soft">
          {folders.map((f) => (
            <li key={f} className="flex items-center gap-2 border-b border-line-soft py-1 pr-1 pl-3 last:border-0">
              <span className="flex-1 truncate font-mono text-[11px]">{f}</span>
              <RoundButton label={`Retirer ${f}`} kind="plain" size="xs" disabled={busy} onClick={() => run(() => api.setLocalFolders(folders.filter((x) => x !== f)))}>
                <X size={12} />
              </RoundButton>
            </li>
          ))}
        </ul>
      )}
      <div className="ml-13 flex gap-2">
        <Button disabled={busy} onClick={add}>
          <FolderPlus size={14} /> Ajouter un dossier
        </Button>
        {folders.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => run(api.rescanLocal)}>
            Rescanner
          </Button>
        )}
      </div>
    </div>
  )
}

export function SourcesView() {
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <p className="text-[13px] text-ink-2">Chaque service se branche avec tes propres clés. Rien ne passe par un serveur : tout reste sur ton ordinateur.</p>
      <div className="rounded-xl border border-line bg-raised">
        {(['youtube', 'spotify'] as const).map((s) => (
          <ServiceRow key={s} service={s} />
        ))}
        <LocalFolders />
      </div>
      <p className="flex w-fit items-center gap-2.5 text-xs text-ink-2">
        <ShieldCheck size={16} /> Tes clés et jetons sont rangés dans le coffre de Windows et ne quittent jamais ce PC.
      </p>
    </div>
  )
}

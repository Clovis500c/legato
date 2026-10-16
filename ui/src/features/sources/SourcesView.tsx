import { HardDrives, ShieldCheck } from '@phosphor-icons/react'
import { useStore } from '../../app/store'
import type { Service } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { Led } from '../../shared/ui/controls'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'

function ServiceRow({ service }: { service: Service }) {
  const { status, disconnect, busy, go, view } = useStore()
  const { connected } = status[service]
  const selected = view.name === 'settings' && view.wizard === service
  return (
    <div className={`flex items-center gap-4 border-b border-line-soft px-4 py-3.5 last:border-0 ${selected ? 'bg-bg' : ''}`}>
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

export function SourcesView() {
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <p className="text-[13px] text-ink-2">Chaque service se branche avec tes propres clés. Rien ne passe par un serveur : tout reste sur ton ordinateur.</p>
      <div className="rounded-xl border border-line bg-raised">
        {(['youtube', 'spotify'] as const).map((s) => (
          <ServiceRow key={s} service={s} />
        ))}
        <div className="flex items-center gap-4 px-4 py-3.5">
          <Led on />
          <span className="grid size-9 place-items-center rounded-full border border-line text-ink-2">
            <HardDrives size={16} />
          </span>
          <div className="flex-1">
            <p className="text-[13px] font-semibold">Fichiers locaux</p>
            <p className="text-xs text-ink-2">Glisse des fichiers audio sur la fenêtre : MP3, FLAC, WAV, OGG, M4A, lus sans blanc entre les titres.</p>
          </div>
          <span className="kicker">Toujours actif</span>
        </div>
      </div>
      <p className="flex w-fit items-center gap-2.5 text-xs text-ink-2">
        <ShieldCheck size={16} /> Tes clés et jetons sont rangés dans le coffre de Windows et ne quittent jamais ce PC.
      </p>
    </div>
  )
}

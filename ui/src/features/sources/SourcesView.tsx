import { ArrowRight, HardDrive, Server, ShieldCheck } from 'lucide-react'
import { useStore } from '../../app/store'
import type { Service } from '../../shared/api'
import { Button, Chip } from '../../shared/ui/Button'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'

const card = 'flex flex-col gap-3.5 rounded-[14px] border p-5'

function ServiceCard({ service, selected, onSelect }: { service: Service; selected: boolean; onSelect: () => void }) {
  const { status, disconnect, busy } = useStore()
  const { connected } = status[service]
  return (
    <article className={`${card} ${selected ? 'border-accent-from bg-[#14111f]' : 'border-line-soft bg-[#111118]'}`}>
      <div className="flex items-center justify-between">
        <span className="grid size-11 place-items-center rounded-xl bg-surface">
          <SourceIcon source={service} size={22} />
        </span>
        <Chip className={connected ? 'bg-[#0f2a1a] font-medium text-[#4ade80]' : 'bg-raised font-medium text-muted'}>
          <span className={`size-1.5 rounded-full ${connected ? 'bg-[#22c55e]' : 'bg-muted'}`} /> {connected ? 'Connecté' : 'Non connecté'}
        </Chip>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">{sourceLabel[service]}</h2>
        <p className="leading-relaxed text-muted">{guides[service].pitch}</p>
      </div>
      {connected ? (
        <Button variant="ghost" className="w-fit" disabled={busy} onClick={() => disconnect(service)}>
          Déconnecter
        </Button>
      ) : (
        <Button className="w-fit" onClick={onSelect}>
          Connecter <ArrowRight size={14} />
        </Button>
      )}
    </article>
  )
}

function SoonCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className={`${card} border-dashed border-[#2a2a35] bg-[#0d0d12]`}>
      <div className="flex items-center justify-between">
        <span className="grid size-11 place-items-center rounded-xl bg-raised text-muted">{icon}</span>
        <Chip className="bg-raised font-medium text-muted">Bientôt</Chip>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold text-[#c4c4cf]">{title}</h2>
        <p className="leading-relaxed text-dim">{text}</p>
      </div>
    </article>
  )
}

export function SourcesView({ wizard, onSelect }: { wizard?: Service; onSelect: (s: Service) => void }) {
  return (
    <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-2 pb-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-[34px] leading-tight font-bold tracking-tight">Tes sources</h1>
        <p className="max-w-155 text-sm leading-relaxed text-muted">
          Tout reste sur ton ordinateur : pas de serveur, pas de compte Music App. Chaque service se connecte avec ton propre compte.
        </p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {(['spotify', 'youtube'] as const).map((s) => (
          <ServiceCard key={s} service={s} selected={wizard === s} onSelect={() => onSelect(s)} />
        ))}
        <SoonCard icon={<HardDrive size={22} className="text-local" />} title="Fichiers locaux" text="FLAC, MP3, OGG, M4A, lus en natif." />
        <SoonCard icon={<Server size={22} />} title="Navidrome / Jellyfin" text="Ton serveur musical perso, via l’API Subsonic." />
      </div>
      <p className="flex w-fit items-center gap-2.5 rounded-[10px] bg-[#111118] px-4 py-3 text-xs text-muted">
        <ShieldCheck size={16} className="text-accent" /> Tes clés et jetons sont rangés dans le coffre de ton système et ne quittent jamais ce PC.
      </p>
    </div>
  )
}

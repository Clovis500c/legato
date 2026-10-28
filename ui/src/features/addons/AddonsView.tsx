import { ArrowSquareOut, CaretDown, Gear, Info, MagnifyingGlass, SealCheck, Tag, WarningCircle } from '@phosphor-icons/react'
import { useShallow } from 'zustand/react/shallow'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { api } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { DISCORD_APP, type DiscordSettings } from '../../shared/theme/theme'
import { onMenu, openMenu, type MenuEntry } from '../../shared/ui/ContextMenu'
import { Led, RoundButton, Segmented, Toggle } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'
import { PageHeader } from '../../shared/ui/PageHeader'
import { addonMenu } from '../menus'
import { useNowTrack, usePlayer } from '../player/store'
import { presenceFor } from './presence'
import { ADDONS, allTags, DISCORD, filterAddons, type Addon, type Author, type Show } from './registry'
import { setAddon } from './state'
import { PluginsSection } from '../plugins/PluginsSection'
import { msg, tr } from '../../shared/i18n/i18n'

const SHOWS: { value: Show; label: string }[] = [
  { value: 'all', label: msg('Show all') },
  { value: 'enabled', label: msg('Turned on') },
  { value: 'disabled', label: msg('Turned off') },
]

/** Button opening a menu right under it (filters). */
function Dropdown({ icon, label, items }: { icon: ReactNode; label: string; items: () => MenuEntry[] }) {
  return (
    <button
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openMenu({ clientX: r.left, clientY: r.bottom + 6, target: e.currentTarget, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent, items())
      }}
      className="flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-3 text-[0.8125rem] hover:border-ink-3"
    >
      <span className="text-ink-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <CaretDown size={12} className="text-ink-3" />
    </button>
  )
}

/** Who made it, at the bottom of each card. Verified = checked by the app's developer. */
function AuthorBadge({ author }: { author: Author }) {
  return author.verified ? (
    <span title={tr('Verified')} className="flex items-center gap-1 font-medium text-ink-2">
      <SealCheck size={14} weight="fill" className="text-accent" /> {tr(author.name)}
    </span>
  ) : (
    <span title={tr('Not checked by the developer')} className="flex items-center gap-1 text-ink-3">
      <WarningCircle size={14} /> {author.name} · {tr('Not verified')}
    </span>
  )
}

function Card({ a, on, onOpen }: { a: Addon; on: boolean; onOpen: () => void }) {
  return (
    <article onContextMenu={onMenu(() => addonMenu(a, onOpen))} className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-4">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold">{a.name}</h3>
        <RoundButton label={a.settings ? tr('{name} settings', { name: a.name }) : tr('About {name}', { name: a.name })} kind="plain" size="xs" onClick={onOpen}>
          {a.settings ? <Gear size={16} /> : <Info size={16} />}
        </RoundButton>
        <Toggle label={tr('Turn on {name}', { name: a.name })} checked={on} onChange={(v) => setAddon(a.id, v)} />
      </div>
      <p className="text-xs leading-relaxed text-ink-2">{tr(a.description)}</p>
      {a.id === DISCORD && <DiscordCardStatus />}
      <footer className="mt-auto flex items-center gap-2 border-t border-line-soft pt-2.5 text-[0.6875rem]">
        <AuthorBadge author={a.author} />
        <span className="flex-1" />
        {a.tags.map((t) => (
          <span key={t} className="rounded-full border border-line-soft px-2 py-0.5 text-ink-3">
            {tr(t)}
          </span>
        ))}
      </footer>
    </article>
  )
}

function Row({ label, sub, children }: { label: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
      <div className="flex-1">
        <p className="text-[0.8125rem] font-medium">{label}</p>
        {sub && <div className="text-xs text-ink-2">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

type Live = 'off' | 'connecting' | 'waiting' | 'connected' | 'error'

// Fixed colors, whatever the theme: a status light reads the same everywhere.
const LIVE: Record<Live, { color: string; label: string; pulse?: boolean }> = {
  off: { color: '#80848E', label: msg('Turned off') },
  connecting: { color: '#F0B232', label: msg('Connecting to Discord…'), pulse: true },
  waiting: { color: '#F0B232', label: msg('Discord isn’t open · retrying every 15 s'), pulse: true },
  connected: { color: '#23A55A', label: msg('Connected to Discord'), pulse: true },
  error: { color: '#F23F43', label: msg('Discord refused') },
}

/** Add-on state from Rust, polled while on. */
function useDiscordLive(): { live: Live; label: string } {
  const on = useSettings((s) => s.settings.addons[DISCORD] === true)
  const appId = useSettings((s) => s.settings.discord.appId)
  const [status, setStatus] = useState<{ connected: boolean; error: string | null; for: string }>()
  useEffect(() => {
    if (!on) return
    let live = true
    const tick = () => void api.discordStatus().then((s) => live && setStatus({ ...s, for: appId }), () => {})
    const first = setTimeout(tick, 300)
    const t = setInterval(tick, 2000)
    return () => {
      live = false
      clearTimeout(first)
      clearInterval(t)
    }
  }, [on, appId])
  // Status of another application id (just changed): not known yet.
  const s = status?.for === appId ? status : undefined
  const live: Live = !on ? 'off' : s?.connected ? 'connected' : !s?.error ? 'connecting' : /isn't open/.test(s.error) ? 'waiting' : 'error'
  return { live, label: live === 'error' ? s!.error! : tr(LIVE[live].label) }
}

function StatusPill({ live, label }: { live: Live; label: string }) {
  const { color, pulse } = LIVE[live]
  return (
    <span role="status" className="flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors" style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <span className="relative flex size-2">
        {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative size-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      </span>
      {label}
    </span>
  )
}

/** What friends see, live with the player. Discord's own dark look, not the theme's. */
function Preview({ d }: { d: DiscordSettings }) {
  const { now, playing, positionMs, durationMs } = usePlayer(useShallow(({ now, playing, positionMs, durationMs }) => ({ now, playing, positionMs, durationMs })))
  const track = useNowTrack()
  const p = presenceFor(now, track, playing, positionMs, durationMs, d)
  const shell = 'flex flex-col gap-2.5 rounded-xl bg-[#232428] p-3.5 text-[#DBDEE1] shadow-[0_8px_24px_rgba(0,0,0,.25)]'
  if (!p) return <div className={`${shell} items-center py-6 text-xs text-[#949BA4]`}>{now ? tr('Paused: nothing shows on Discord') : tr('Play a song to see the preview')}</div>
  const pct = p.playing && p.durationMs ? Math.min(100, (p.positionMs / p.durationMs) * 100) : 0
  return (
    <div aria-label={tr('Discord preview')} className={shell}>
      <p className="truncate text-[0.6875rem] font-bold tracking-wide text-[#B5BAC1] uppercase">{tr('Listening to {name}', { name: d.status === 'song' ? p.title : d.status === 'artist' ? p.artist : 'Music App' })}</p>
      <div className="flex items-center gap-3">
        <Cover title={p.title} art={track ? trackArt(track) : []} size={64} className="rounded-lg! border-0!" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[0.8125rem]">
          <p className="truncate font-semibold text-white">{p.title}</p>
          <p className="truncate text-[#B5BAC1]">{p.artist}</p>
          {p.album && <p className="truncate text-xs text-[#949BA4]">{p.album}</p>}
        </div>
      </div>
      {p.playing && p.durationMs ? (
        <div className="flex items-center gap-2 font-mono text-[0.625rem] text-[#B5BAC1]">
          <span>{formatDuration(p.positionMs) || '0:00'}</span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[#4E5058]">
            <span className="block h-full rounded-full bg-white transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </span>
          <span>{formatDuration(p.durationMs)}</span>
        </div>
      ) : (
        !p.playing && <p className="text-[0.6875rem] text-[#949BA4]">{tr('Paused')}</p>
      )}
      {p.buttons.map(([label]) => (
        <span key={label} className="rounded-[3px] bg-[#4E5058] py-1.5 text-center text-[0.8125rem] font-medium text-white">
          {label}
        </span>
      ))}
    </div>
  )
}

function DiscordPanel() {
  const d = useSettings((s) => s.settings.discord)
  const update = useSettings((s) => s.update)
  const set = (patch: Partial<DiscordSettings>) => update({ discord: { ...useSettings.getState().settings.discord, ...patch } })
  const { live, label } = useDiscordLive()
  const [id, setId] = useState(d.appId)
  const saveId = () => {
    const next = id || DISCORD_APP
    setId(next)
    if (next !== d.appId) set({ appId: next })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <StatusPill live={live} label={label} />
        <Toggle label={tr('Turn on {name}', { name: 'Discord Rich Presence' })} checked={live !== 'off'} onChange={(v) => setAddon(DISCORD, v)} />
      </div>
      <Preview d={d} />
      <div className={`rounded-xl border border-line bg-raised transition-opacity ${live === 'off' ? 'opacity-60' : ''}`}>
        <Row label={tr('After “Listening to”')} sub={tr('In the member list. Your profile shows everything.')}>
          <Segmented label={tr('Status shows')} value={d.status} onChange={(status) => set({ status })} options={[{ value: 'name', label: tr('App name') }, { value: 'artist', label: tr('Artist') }, { value: 'song', label: tr('Song') }]} />
        </Row>
        <Row label={tr('Button to the song')} sub={tr('Listen on YouTube, Spotify or Apple Music')}>
          <Toggle label={tr('Button to the song')} checked={d.buttons} onChange={(buttons) => set({ buttons })} />
        </Row>
        <Row label="Get App On GitHub" sub={tr('Button to the app’s page, for friends who want it')}>
          <Toggle label={tr('“Get App On GitHub” button')} checked={d.github} onChange={(github) => set({ github })} />
        </Row>
        <Row label={tr('Show while paused')} sub={tr('Off: nothing shows on Discord while paused')}>
          <Toggle label={tr('Show while paused')} checked={d.paused} onChange={(paused) => set({ paused })} />
        </Row>
        <Row
          label={tr('Discord application')}
          sub={
            <>
              {d.appId === DISCORD_APP ? tr('Music App’s own.') : tr('Your own.')} {tr('Use yours to change the name after “Listening to”.')}{' '}
              <button onClick={() => void openUrl('https://discord.com/developers/applications')} className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline">
                Developer Portal <ArrowSquareOut size={11} />
              </button>
            </>
          }
        >
          {d.appId !== DISCORD_APP && (
            <button onClick={() => (setId(DISCORD_APP), set({ appId: DISCORD_APP }))} className="text-xs font-medium text-ink-2 hover:text-ink">
              {tr('Use default')}
            </button>
          )}
        </Row>
        <div className="px-4 pb-3">
          <input
            value={id}
            inputMode="numeric"
            placeholder={DISCORD_APP}
            aria-label={tr('Discord application ID')}
            onChange={(e) => setId(e.target.value.replace(/\D/g, '').slice(0, 32))}
            onBlur={saveId}
            onKeyDown={(e) => e.key === 'Enter' && saveId()}
            className="h-8 w-full rounded-md border border-line bg-bg px-2.5 font-mono text-[0.75rem] outline-none placeholder:text-ink-3 focus:border-ink-3"
          />
        </div>
      </div>
      <p className="text-[0.6875rem] text-ink-3">{tr('Talks to the Discord app on this PC only. Song, artist, cover link and song link go to Discord while this is on. Discord hides your own buttons from you; friends see them.')}</p>
    </div>
  )
}

/** Live state on the card (on only). */
function DiscordCardStatus() {
  const { live, label } = useDiscordLive()
  return live === 'off' ? null : <StatusPill live={live} label={label} />
}

function About({ a }: { a: Addon }) {
  return (
    <div className="flex flex-col gap-3 text-[0.8125rem]">
      <p className="text-ink-2">{tr(a.description)}</p>
      <AuthorBadge author={a.author} />
    </div>
  )
}

export function AddonsView() {
  const on = useSettings((s) => s.settings.addons)
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [tags, setTags] = useState<string[]>([])
  const [open, setOpen] = useState<Addon | null>(null)
  const shown = filterAddons(ADDONS, { query, show, tags, on })
  const enabled = ADDONS.filter((a) => on[a.id]).length
  const stats = [
    { label: tr('Turned on'), value: enabled },
    { label: tr('Total'), value: ADDONS.length },
    { label: tr('Verified'), value: ADDONS.filter((a) => a.author.verified).length },
  ]
  return (
    <>
      <PageHeader kicker={tr('Extras')} title={tr('Add-ons')} sub={tr('Extra features, off until you turn them on. The cog opens an add-on’s settings.')} />
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 divide-x divide-line-soft rounded-xl border border-line bg-raised py-3">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-0.5">
                <span className="kicker">{s.label}</span>
                <span className="font-mono text-2xl font-semibold tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>

          <section className="flex flex-col gap-2.5">
            <h2 className="kicker">{tr('Filters')}</h2>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-3 focus-within:border-ink-3">
              <MagnifyingGlass size={14} className="text-ink-3" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Search for an add-on…')} aria-label={tr('Search add-ons')} className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-ink-3" />
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <Dropdown icon={<Led on={show !== 'all'} />} label={tr(SHOWS.find((s) => s.value === show)!.label)} items={() => SHOWS.map((s) => ({ label: tr(s.label), checked: s.value === show, onSelect: () => setShow(s.value) }))} />
              <Dropdown
                icon={<Tag size={14} />}
                label={tags.length ? tags.map((t) => tr(t)).join(', ') : tr('Filter by tags')}
                items={() => [
                  ...allTags(ADDONS).map((t) => ({ label: tr(t), checked: tags.includes(t), onSelect: () => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t])) })),
                  '-' as const,
                  { label: tr('Any tag'), disabled: !tags.length, onSelect: () => setTags([]) },
                ]}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="kicker">{tr('Add-ons')}</h2>
            {shown.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                {shown.map((a) => (
                  <Card key={a.id} a={a} on={on[a.id] === true} onOpen={() => setOpen(a)} />
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-[0.8125rem] text-ink-3">{tr('No add-on matches these filters.')}</p>
            )}
          </section>

          <PluginsSection query={query} />
        </div>
      </div>
      {open && (
        <Dialog title={open.name} kicker={open.settings ? tr('Add-on settings') : tr('Add-on')} onClose={() => setOpen(null)}>
          {open.id === DISCORD ? <DiscordPanel /> : <About a={open} />}
        </Dialog>
      )}
    </>
  )
}

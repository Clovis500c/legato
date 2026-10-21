import { ShortcutsSection } from './ShortcutsSection'
import { ArrowCounterClockwise, Check, CheckCircle, Info, ClipboardText, Copy, Keyboard, MagnifyingGlass, PaintBrush, Palette as PaletteIcon, Plugs, Plus, ShieldCheck, Sliders, Trash, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore, type SettingsSection } from '../../app/store'
import { api } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { ACCENTS, ADAPTIVE_LEVELS, COLUMNS, contrastReport, DEFAULTS, type AdaptiveLevel, PALETTE_KEYS, PRESETS, sanitizeTheme, type Column, type Palette, type PaletteKey, type Settings, type Theme } from '../../shared/theme/theme'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton, Segmented, Toggle } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { curveLabels } from '../player/fade'
import { usePlayer } from '../player/store'
import { useLive } from '../player/live'
import { SourcesView } from '../sources/SourcesView'
import { AboutSection } from './AboutSection'
import { FadeEditor } from './FadeEditor'
import { CountsScene, CoverShapes, DensityScene, FadeScene, ListCoversScene, MiniPlayerScene, MixCoverScene, MotionScene, NowPlayingScene, SourceIconScene, TunerScene, VolumeScene } from './previews'
import { searchSettings, type SettingEntry } from './search'

const sections: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <PaintBrush size={15} /> },
  { id: 'themes', label: 'Themes', icon: <PaletteIcon size={15} /> },
  { id: 'sources', label: 'Accounts', icon: <Plugs size={15} /> },
  { id: 'shield', label: 'Shield', icon: <ShieldCheck size={15} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={15} /> },
  { id: 'advanced', label: 'Advanced', icon: <Sliders size={15} /> },
  { id: 'about', label: 'About', icon: <Info size={15} /> },
]

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section data-setting={title.split(' · ')[0]} className="flex flex-col gap-2.5 rounded-lg">
      <div className="flex items-center justify-between">
        <h2 className="kicker">{title}</h2>
        {hint && <span className="kicker">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/** preview = live picture of what the setting changes, redrawn with its value. */
function Row({ label, sub, children, preview }: { label: string; sub?: string; children: ReactNode; preview?: ReactNode }) {
  return (
    <div data-setting={label} className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
      <div className="flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        {sub && <p className="text-xs text-ink-2">{sub}</p>}
      </div>
      {preview}
      {children}
    </div>
  )
}

/** Mini window drawn in the theme's own colors. */
function ThemeThumb({ t }: { t: Palette }) {
  return (
    <span className="relative block h-23 w-full overflow-hidden" style={{ background: t.bg }}>
      <span className="absolute inset-y-0 left-0 w-[24%]" style={{ background: t.panel }} />
      <span className="absolute top-3 left-[5%] size-1.5 rounded-full" style={{ background: t.accent }} />
      {[0, 1, 2].map((i) => (
        <span key={i} className="absolute left-[5%] h-[3px] w-[13%] rounded-full" style={{ top: 12 + i * 8, marginLeft: i ? 0 : 9, background: i ? t.ink4 : t.ink }} />
      ))}
      <span className="absolute top-3 left-[30%] h-1.5 w-[32%] rounded-full" style={{ background: t.ink }} />
      {[0, 1, 2].map((i) => (
        <span key={i} className="absolute left-[30%] flex w-[64%] items-center gap-1.5" style={{ top: 25 + i * 13 }}>
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: t.recess }} />
          <span className="h-[3px] rounded-full" style={{ width: `${55 - i * 12}%`, background: i === 1 ? t.accent : t.ink2 }} />
        </span>
      ))}
      <span className="absolute inset-x-0 bottom-0 h-5" style={{ background: t.panel, borderTop: `1px solid ${t.line}` }} />
      <span className="absolute bottom-1 left-1/2 size-3 -translate-x-1/2 rounded-full" style={{ background: t.accent }} />
    </span>
  )
}

function ThemeCard({ t, on, onClick, badge }: { t: Palette; on: boolean; onClick: () => void; badge?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className="flex flex-col gap-2 text-left">
      <span className={`block overflow-hidden rounded-lg border-2 ${on ? 'border-ink' : 'border-transparent outline outline-1 outline-line'}`}>
        <ThemeThumb t={t} />
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {on && <Led on />} <span className="flex-1 truncate">{'name' in t ? (t as Theme).name : 'System'}</span>
        <span className="font-mono text-[9px] text-ink-3">{badge ?? t.accent}</span>
      </span>
    </button>
  )
}

function ThemeGallery({ onEdit }: { onEdit?: (id: string) => void }) {
  const { settings, update, current } = useSettings()
  const system = { ...current('system'), name: 'System' }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
      {PRESETS.map((t) => (
        <ThemeCard key={t.id} t={t} on={settings.theme === t.id} onClick={() => update({ theme: t.id })} />
      ))}
      <ThemeCard t={system} on={settings.theme === 'system'} onClick={() => update({ theme: 'system' })} badge="AUTO" />
      {settings.customThemes.map((t) => (
        <ThemeCard key={t.id} t={t} on={settings.theme === t.id} badge="CUSTOM" onClick={() => (onEdit ? onEdit(t.id) : update({ theme: t.id }))} />
      ))}
    </div>
  )
}

/** Applied on "Apply" only: zooming while dragging moves the slider under the pointer. */
function InterfaceSize() {
  const { settings: s, update } = useSettings()
  const [draft, setDraft] = useState<number | null>(null)
  const v = draft ?? s.zoom
  const apply = () => {
    update({ zoom: v })
    setDraft(null)
  }
  return (
    <Group title="Interface size" hint={`${v}%`}>
      <div className="flex h-8 items-center gap-3">
        <input type="range" aria-label="Interface size" min={90} max={125} step={5} value={v} onChange={(e) => setDraft(+e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} className="bar w-60" style={{ background: `linear-gradient(to right, var(--ink) ${((v - 90) / 35) * 100}%, var(--line) 0)` }} />
        {draft !== null && draft !== s.zoom && (
          <>
            <Button onClick={apply}>Apply {v}%</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </Group>
  )
}

const fonts: { value: Settings['font']; label: string }[] = [
  { value: 'theme', label: 'Theme' },
  { value: 'modern', label: 'Modern' },
  { value: 'hifi', label: 'Hi-Fi' },
  { value: 'neutral', label: 'Windows' },
]

function Appearance() {
  const { settings: s, update, current } = useSettings()
  const go = useStore((st) => st.go)
  const col = (c: Column) => (s.columns.includes(c) ? s.columns.filter((x) => x !== c) : COLUMNS.filter((x) => x === c || s.columns.includes(x)))
  const labels: Record<Column, string> = { album: 'Album', sources: 'Sources', duration: 'Duration' }
  const reset: Partial<Settings> = { accent: DEFAULTS.accent, covers: DEFAULTS.covers, density: DEFAULTS.density, zoom: DEFAULTS.zoom, readout: DEFAULTS.readout, volume: DEFAULTS.volume, tuner: DEFAULTS.tuner, columns: DEFAULTS.columns, tint: DEFAULTS.tint, immersive: DEFAULTS.immersive, miniPlayer: DEFAULTS.miniPlayer, font: DEFAULTS.font, motion: DEFAULTS.motion, sidebarCounts: DEFAULTS.sidebarCounts, listCovers: DEFAULTS.listCovers, clickToPlay: DEFAULTS.clickToPlay, crossfade: DEFAULTS.crossfade, fade: DEFAULTS.fade, youtubeControls: DEFAULTS.youtubeControls, stage: DEFAULTS.stage, miniSpot: DEFAULTS.miniSpot }
  return (
    <div className="flex flex-col gap-7">
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => update(reset)}>
          <ArrowCounterClockwise size={14} /> Reset appearance
        </Button>
      </div>
      <Group title="Theme">
        <ThemeGallery />
      </Group>
      <Group title="Accent color" hint={s.accent === 'system' ? 'from Windows' : (s.accent ?? 'from theme')}>
        <div className="flex flex-wrap items-center gap-2">
          {([['system', 'Windows'], [null, 'Theme']] as const).map(([value, label]) => (
            <button key={label} onClick={() => update({ accent: value })} aria-pressed={s.accent === value} className={`rounded-full px-3 py-1.5 text-xs font-medium ${s.accent === value ? 'bg-ink text-bg' : 'border border-line'}`}>
              {label}
            </button>
          ))}
          {ACCENTS.map((c) => (
            <button key={c} aria-label={`Accent ${c}`} aria-pressed={s.accent === c} onClick={() => update({ accent: c })} className={`grid size-8.5 place-items-center rounded-full ${s.accent === c ? 'border-2 border-ink' : ''}`}>
              <span className="size-6 rounded-full" style={{ background: c }} />
            </button>
          ))}
          <label className="grid size-8.5 cursor-pointer place-items-center rounded-full border border-dashed border-ink-3" title="Any color">
            <Plus size={12} />
            <input type="color" className="sr-only" value={current().accent.toLowerCase()} onChange={(e) => update({ accent: e.target.value })} />
          </label>
        </div>
      </Group>
      <Group title="Font" hint={s.font === 'theme' ? `theme: ${current().font}` : undefined}>
        <Segmented label="Font" value={s.font} onChange={(font) => update({ font })} options={fonts} />
      </Group>
      <div className="grid grid-cols-2 gap-6">
        <Group title="Covers">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label="Cover shape" value={s.covers} onChange={(covers) => update({ covers })} options={[{ value: 'net', label: 'Sharp' }, { value: 'rounded', label: 'Rounded' }, { value: 'vinyl', label: 'Vinyl' }]} />
            <CoverShapes covers={s.covers} />
          </div>
        </Group>
        <Group title="List density">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label="Density" value={s.density} onChange={(density) => update({ density })} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfort', label: 'Comfortable' }, { value: 'airy', label: 'Airy' }]} />
            <DensityScene density={s.density} />
          </div>
        </Group>
      </div>
      <InterfaceSize />
      <Group title="Player">
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Source icon" sub="Where the song plays from, next to the volume" preview={<SourceIconScene readout={s.readout} />}>
            <Toggle label="Source icon" checked={s.readout} onChange={(readout) => update({ readout })} />
          </Row>
          <Row label="Volume control" preview={<VolumeScene volume={s.volume} />}>
            <Segmented label="Volume control" value={s.volume} onChange={(volume) => update({ volume })} options={[{ value: 'knob', label: 'Knob' }, { value: 'bar', label: 'Bar' }]} />
          </Row>
          <Row label="Fade between songs" preview={!s.fade.advanced && <FadeScene crossfade={s.crossfade} />} sub={s.fade.advanced ? `Advanced: ${s.fade.out} s out (${curveLabels[s.fade.outCurve]}), ${s.fade.in} s in (${curveLabels[s.fade.inCurve]})` : s.crossfade ? `${s.crossfade} s fade out, then in, when a song ends on its own` : 'Off'}>
            {s.fade.advanced ? (
              <Button variant="ghost" onClick={() => go({ name: 'settings', section: 'advanced', focus: 'Advanced fade' })}>
                Edit curves
              </Button>
            ) : (
              <input type="range" aria-label="Fade between songs" min={0} max={12} step={1} value={s.crossfade} onChange={(e) => update({ crossfade: +e.target.value })} className="bar w-40" style={{ background: `linear-gradient(to right, var(--ink) ${(s.crossfade / 12) * 100}%, var(--line) 0)` }} />
            )}
          </Row>
          <Row label="Tuner scale" sub="Tuner-style progress bar in full screen" preview={<TunerScene tuner={s.tuner} />}>
            <Toggle label="Tuner scale" checked={s.tuner} onChange={(tuner) => update({ tuner })} />
          </Row>
          <Row label="Immersive player" sub="Now Playing over the song's cover, big and blurred" preview={<NowPlayingScene s={s} />}>
            <Toggle label="Immersive player" checked={s.immersive} onChange={(immersive) => update({ immersive })} />
          </Row>
          <Row label="Cover tint" sub="Now Playing takes a flat color from the cover (when immersive is off)" preview={<NowPlayingScene s={{ ...s, immersive: false }} />}>
            <Toggle label="Cover tint" checked={s.tint} onChange={(tint) => update({ tint })} />
          </Row>
          <Row label="Mini player" sub="Floating player for every source. YouTube always shows one: its video must stay visible." preview={<MiniPlayerScene miniPlayer={s.miniPlayer} />}>
            <Toggle label="Mini player" checked={s.miniPlayer} onChange={(miniPlayer) => update({ miniPlayer })} />
          </Row>
        </div>
      </Group>
      <Group title="Lists and navigation">
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Covers in lists" preview={<ListCoversScene listCovers={s.listCovers} />}>
            <Toggle label="Covers in lists" checked={s.listCovers} onChange={(listCovers) => update({ listCovers })} />
          </Row>
          <Row label="Play with" sub="On a track row">
            <Segmented label="Play with" value={s.clickToPlay} onChange={(clickToPlay) => update({ clickToPlay })} options={[{ value: 'single', label: 'One click' }, { value: 'double', label: 'Double-click' }]} />
          </Row>
          <Row label="Counts in the sidebar" sub="Number of songs next to each entry" preview={<CountsScene sidebarCounts={s.sidebarCounts} />}>
            <Toggle label="Counts in the sidebar" checked={s.sidebarCounts} onChange={(sidebarCounts) => update({ sidebarCounts })} />
          </Row>
          <Row label="Open on" sub={s.reopen ? 'Used when “Reopen where you left off” is off (Advanced)' : 'Screen shown when the app starts'}>
            <Segmented label="Open on" value={s.startView} onChange={(startView) => update({ startView })} options={[{ value: 'home', label: 'Home' }, { value: 'songs', label: 'Songs' }, { value: 'mixes', label: 'Mixes' }, { value: 'albums', label: 'Albums' }, { value: 'artists', label: 'Artists' }]} />
          </Row>
          <Row label="Animations" sub="Transitions and fades" preview={<MotionScene motion={s.motion} />}>
            <Toggle label="Animations" checked={s.motion} onChange={(motion) => update({ motion })} />
          </Row>
        </div>
      </Group>
      <Group title="List columns">
        <div className="flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => {
            const on = s.columns.includes(c)
            return (
              <button key={c} aria-pressed={on} onClick={() => update({ columns: col(c) })} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${on ? 'bg-ink text-bg' : 'border border-line text-ink-2'}`}>
                {on ? <Check size={11} /> : <Plus size={11} />} {labels[c]}
              </button>
            )
          })}
        </div>
      </Group>
    </div>
  )
}

const slotLabels: Record<PaletteKey, string> = { bg: 'Background', panel: 'Panel', raised: 'Surface', recess: 'Recess (readouts)', line: 'Lines', lineSoft: 'Soft lines', ink: 'Text', ink2: 'Secondary text', ink3: 'Muted text', ink4: 'Decor', accent: 'Accent', onAccent: 'Icon on accent', ledOff: 'LED off' }

function ColorSlot({ k, value, onChange }: { k: PaletteKey; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <label className="flex items-center gap-3 px-1 py-1.5">
      <span className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line" style={{ background: value }}>
        <input type="color" aria-label={slotLabels[k]} value={value} onChange={(e) => (onChange(e.target.value.toUpperCase()), setDraft(e.target.value.toUpperCase()))} className="absolute inset-0 cursor-pointer opacity-0" />
      </span>
      <span className="flex-1 text-xs">{slotLabels[k]}</span>
      <input
        value={draft}
        aria-label={`${slotLabels[k]}, hex code`}
        onChange={(e) => {
          setDraft(e.target.value)
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase())
        }}
        className="w-20 rounded border border-line-soft bg-transparent px-1.5 py-0.5 font-mono text-[10px] uppercase"
      />
    </label>
  )
}

function ThemeEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { settings, update } = useSettings()
  const [copied, setCopied] = useState(false)
  const t = settings.customThemes.find((x) => x.id === id)
  if (!t) return null
  const save = (patch: Partial<Theme>) => update({ customThemes: settings.customThemes.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const report = contrastReport(t)
  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 self-start rounded-xl border border-line bg-raised p-4.5 shadow-[0_8px_24px_var(--shadow)]">
      <div className="flex items-center gap-3">
        <span className="size-6.5 rounded-full border-[5px]" style={{ background: t.accent, borderColor: t.bg }} />
        <input value={t.name} aria-label="Theme name" maxLength={40} onChange={(e) => save({ name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-lg font-bold tracking-tight outline-none" />
        <RoundButton label="Close editor" kind="plain" size="xs" onClick={onClose}>
          ×
        </RoundButton>
      </div>
      <div className="grid grid-cols-1 divide-y divide-line-soft">
        {PALETTE_KEYS.map((k) => (
          <ColorSlot key={k} k={k} value={t[k]} onChange={(v) => save({ [k]: v })} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="kicker">Font</span>
        <Segmented label="Font" value={t.font} onChange={(font) => save({ font })} options={[{ value: 'modern', label: 'Modern' }, { value: 'hifi', label: 'Hi-Fi' }, { value: 'neutral', label: 'Windows' }]} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">LED glow</span>
        <Toggle label="LED glow" checked={t.glow} onChange={(glow) => save({ glow })} />
      </div>
      <div className="flex flex-col gap-1.5 rounded-lg bg-recess p-3">
        <span className="kicker">Contrast · checked live</span>
        {report.map((c) => (
          <span key={c.label} className="flex items-center gap-2 text-xs">
            {c.ok ? <CheckCircle size={14} className="text-ink-2" /> : <WarningCircle size={14} className="text-danger" />}
            <span className="flex-1">{c.label}</span>
            <span className={`font-mono text-[10px] ${c.ok ? 'text-ink-2' : 'text-danger'}`}>
              {c.ratio.toFixed(1)}:1 {c.ok ? 'AA' : `< ${c.min}`}
            </span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button className="flex-1" onClick={() => update({ theme: t.id })} disabled={settings.theme === t.id}>
          {settings.theme === t.id ? 'Applied' : 'Apply'}
        </Button>
        <RoundButton
          label={copied ? 'Copied to clipboard' : 'Export (copies the .theme)'}
          onClick={() =>
            navigator.clipboard.writeText(JSON.stringify(t, null, 2)).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </RoundButton>
        <RoundButton
          label="Delete theme"
          onClick={() => {
            update({ customThemes: settings.customThemes.filter((x) => x.id !== id), ...(settings.theme === id ? { theme: 'paper' } : {}) })
            onClose()
          }}
        >
          <Trash size={15} />
        </RoundButton>
      </div>
    </aside>
  )
}

function Themes() {
  const { settings, update, current } = useSettings()
  const [editing, setEditing] = useState<string>()
  const [importing, setImporting] = useState(false)
  const [paste, setPaste] = useState('')
  const [bad, setBad] = useState(false)
  const add = (t: Theme) => {
    update({ customThemes: [...settings.customThemes, t] })
    setEditing(t.id)
  }
  return (
    <div className="flex gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <p className="text-[13px] text-ink-2">Click a theme to apply it. A custom theme opens in the editor: tune every color, contrast is checked live.</p>
        <Group title={`Themes · ${PRESETS.length + 1 + settings.customThemes.length}`} hint={`Applied: ${current().name}`}>
          <ThemeGallery onEdit={setEditing} />
        </Group>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => add({ ...current(), id: `custom-${Date.now().toString(36)}`, name: `${current().name} custom` })}>
            <Plus size={14} /> New theme (copy of current)
          </Button>
          <Button variant="ghost" onClick={() => setImporting(!importing)}>
            <ClipboardText size={14} /> Import a .theme
          </Button>
        </div>
        {importing && (
          <div className="flex flex-col gap-2">
            <textarea value={paste} onChange={(e) => (setPaste(e.target.value), setBad(false))} rows={5} placeholder="Paste the contents of a .theme file here" className="rounded-lg border border-line bg-raised p-3 font-mono text-[11px]" />
            <div className="flex items-center gap-3">
              <Button
                disabled={!paste.trim()}
                onClick={() => {
                  let theme: Theme | null = null
                  try {
                    theme = sanitizeTheme({ ...JSON.parse(paste), id: undefined })
                  } catch {
                    theme = null
                  }
                  if (!theme) return setBad(true)
                  add(theme)
                  setPaste('')
                  setImporting(false)
                }}
              >
                Add
              </Button>
              {bad && <span className="text-xs text-danger">Invalid theme: all 13 colors are needed, as #RRGGBB.</span>}
            </div>
          </div>
        )}
      </div>
      {editing && <ThemeEditor key={editing} id={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}

function ShieldSection() {
  const { settings, update } = useSettings()
  const [blocked, setBlocked] = useState(0)
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    const tick = () => api.shieldStatus().then((s) => setBlocked(s.blocked))
    void tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <p className="text-[13px] text-ink-2">Blocks ads and trackers with Brave’s engine (adblock-rust) and the EasyList and EasyPrivacy lists, updated every 4 days. In the YouTube player, ad slots are removed before playback.</p>
      <div className="rounded-xl border border-line bg-raised">
        <Row label="Block ads and trackers" sub="Network: right away. YouTube player: on next launch.">
          <Toggle
            label="Block ads and trackers"
            checked={settings.shield}
            onChange={(shield) => {
              update({ shield })
              void api.setShield(shield)
              setChanged(true)
            }}
          />
        </Row>
        <Row label="Blocked requests" sub="Since app launch">
          <span className="font-mono text-2xl tabular-nums">{formatCount(blocked)}</span>
        </Row>
        <Row label="Lists" sub="EasyList · EasyPrivacy · built-in rules (offline)">
          <span className="flex items-center gap-2 kicker">
            <Led on={settings.shield} /> {settings.shield ? 'On' : 'Off'}
          </span>
        </Row>
      </div>
      {changed && (
        <div className="flex items-center gap-4 rounded-lg border border-line bg-recess px-4 py-3">
          <p className="flex-1 text-xs">Restart the app to apply the change to the YouTube player.</p>
          <Button onClick={() => void api.restartApp()}>Restart</Button>
        </div>
      )}
      <p className="text-xs text-ink-2">Note: YouTube’s terms forbid blocking ads in its player. Risks: your API key gets revoked, or playback breaks when YouTube changes its player. YouTube Premium removes ads without this risk.</p>
    </div>
  )
}

/** Plain 0..max slider in the settings style. */
function Slider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return <input type="range" aria-label={label} min={0} max={max} step={1} value={value} onChange={(e) => onChange(+e.target.value)} className="bar w-40" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${(value / max) * 100}%, var(--line) 0)` }} />
}

/** Lives in Windows, not in settings: read on open, so a switch flipped in Task Manager shows here too. Hidden elsewhere. */
function OpenAtStartup() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    api.autostart().then(setOn, () => setOn(null))
  }, [])
  if (on === null) return null
  const change = (v: boolean) => {
    setOn(v)
    api.setAutostart(v).catch((e) => {
      setOn(!v)
      useStore.getState().notify(String(e), { kind: 'error' })
    })
  }
  return (
    <Row label="Open at startup" sub="Opens when you sign in to Windows. Also in Task Manager › Startup apps">
      <Toggle label="Open at startup" checked={on} onChange={change} />
    </Row>
  )
}

const levelLabels: Record<AdaptiveLevel, string> = { [-20]: 'Quiet', [-14]: 'Normal', [-11]: 'Loud' }

/** Live processing of what plays (player/live.ts): local files and previews in the app's engine, YouTube in its player. */
function SoundGroup() {
  const { settings: s, update } = useSettings()
  const youtubeError = useLive((l) => l.error)
  const used = s.adaptiveSound || s.coverPulse
  return (
    <Group title="Sound processing">
      <div className="rounded-xl border border-line bg-raised">
        <Row label="Adaptive Sound" sub="Loud and quiet songs end up alike, adjusted as they play. A thin line under the volume shows the result. Local files and YouTube; not Spotify (its own app plays it).">
          <Toggle label="Adaptive Sound" checked={s.adaptiveSound} onChange={(adaptiveSound) => update({ adaptiveSound })} />
        </Row>
        {s.adaptiveSound && (
          <Row label="Adaptive Sound level" sub={`Where songs are brought: ${s.adaptiveLevel} LUFS`}>
            <Segmented
              label="Adaptive Sound level"
              value={String(s.adaptiveLevel)}
              onChange={(v) => update({ adaptiveLevel: Number(v) as AdaptiveLevel })}
              options={ADAPTIVE_LEVELS.map((l) => ({ value: String(l), label: levelLabels[l] }))}
            />
          </Row>
        )}
        <Row label="Moving cover" sub={s.motion ? 'In Now Playing, the cover swells and settles with the music' : 'Needs Animations on (Appearance)'}>
          <Toggle label="Moving cover" checked={s.coverPulse} onChange={(coverPulse) => update({ coverPulse })} />
        </Row>
        <Row
          label="Process YouTube's sound"
          sub={
            !s.liveYoutube
              ? 'Off: YouTube plays untouched; the features above work on local files only'
              : used && youtubeError
                ? `Not on this video: ${youtubeError}. It plays as usual.`
                : 'Used by the features above. Nothing is recorded or saved; the video plays as usual if this fails.'
          }
        >
          <Toggle label="Process YouTube's sound" checked={s.liveYoutube} onChange={(liveYoutube) => update({ liveYoutube })} />
        </Row>
      </div>
    </Group>
  )
}

function AdvancedSection() {
  const { settings: s, update } = useSettings()
  const playing = usePlayer((p) => !!p.now)
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <Group title="Fade between songs">
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Advanced fade" sub={s.fade.advanced ? 'Your own lengths and shapes, below' : `Off: ${s.crossfade ? `${s.crossfade} s each way, S-curve` : 'no fade'} (Appearance › Player)`}>
            <Toggle label="Advanced fade" checked={s.fade.advanced} onChange={(advanced) => update({ fade: { ...s.fade, advanced } })} />
          </Row>
        </div>
        {s.fade.advanced && <FadeEditor />}
      </Group>
      <SoundGroup />
      <Group title="Immersive player">
        <div className="rounded-xl border border-line bg-raised">
          <div className="flex items-center gap-5 border-b border-line-soft p-4">
            <NowPlayingScene s={{ ...s, immersive: true }} big />
            <p className="max-w-48 text-xs text-ink-2">
              {s.immersive ? 'Live preview: move the sliders and watch the background change.' : 'Immersive player is off (Appearance › Player): this is how it would look.'}
              {playing ? '' : ' Play a song to see it with its own cover.'}
            </p>
          </div>
          <Row label="Background blur" sub={s.backdropBlur ? `${s.backdropBlur} px` : 'Sharp'}>
            <Slider label="Background blur" value={s.backdropBlur} max={80} onChange={(backdropBlur) => update({ backdropBlur })} />
          </Row>
          <Row label="Background dimming" sub={`${s.backdropDim} %: veil in the theme's color, keeps text readable`}>
            <Slider label="Background dimming" value={s.backdropDim} max={80} onChange={(backdropDim) => update({ backdropDim })} />
          </Row>
          <Row label="Background motion" sub="The cover drifts slowly behind the player">
            <Toggle label="Background motion" checked={s.backdropMotion} onChange={(backdropMotion) => update({ backdropMotion })} />
          </Row>
        </div>
      </Group>
      <Group title="Mixes">
        <div className="rounded-xl border border-line bg-raised">
          <Row label="Mix covers" sub="Four of the mix's song covers like playlists, the first one, or the plain numbered tile" preview={<MixCoverScene mixCovers={s.mixCovers} />}>
            <Segmented
              label="Mix covers"
              value={s.mixCovers}
              onChange={(mixCovers) => update({ mixCovers })}
              options={[
                { value: 'grid', label: 'Grid of 4' },
                { value: 'single', label: 'Single' },
                { value: 'template', label: 'Template' },
              ]}
            />
          </Row>
        </div>
      </Group>
      <div className="rounded-xl border border-line bg-raised">
        <OpenAtStartup />
        <Row label="Keep running in the notification area" sub={s.closeToTray ? 'Closing the window keeps the music going; Quit from the icon’s menu' : 'Closing the window quits the app'}>
          <Toggle label="Keep running in the notification area" checked={s.closeToTray} onChange={(closeToTray) => update({ closeToTray })} />
        </Row>
        <Row label="Reopen where you left off" sub="Same screen as when the app closed, Now Playing open if it was">
          <Toggle label="Reopen where you left off" checked={s.reopen} onChange={(reopen) => update({ reopen })} />
        </Row>
        <Row label="Resume playback on launch" sub="The last song picks up where it stopped, with its queue, when the app opens">
          <Toggle label="Resume playback on launch" checked={s.resume} onChange={(resume) => update({ resume })} />
        </Row>
        <Row label="Voice search" sub="The mic beside the search bar. Windows’ online speech recognition: your voice goes to Microsoft’s service while the mic listens, nothing is kept">
          <Toggle label="Voice search" checked={s.voiceSearch} onChange={(voiceSearch) => update({ voiceSearch })} />
        </Row>
        <Row label="Subtitles on videos" sub="Off: hidden even when your Google account shows them">
          <Toggle label="Subtitles on videos" checked={s.subtitles} onChange={(subtitles) => update({ subtitles })} />
        </Row>
        <Row label="YouTube controls on the video" sub="YouTube's own title, buttons and hover menu on the video. From the next track.">
          <Toggle label="YouTube controls on the video" checked={s.youtubeControls} onChange={(youtubeControls) => update({ youtubeControls })} />
        </Row>
      </div>
    </div>
  )
}

/** Search box over the section list: results replace it while typing, Enter opens the first. */
function SettingsSearch({ onPick }: { onPick: (e: SettingEntry) => void }) {
  const [q, setQ] = useState('')
  const hits = searchSettings(q).slice(0, 12)
  const pick = (e: SettingEntry) => {
    setQ('')
    onPick(e)
  }
  return (
    <>
      <label className="mb-2 flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-ink-3 focus-within:border-ink-3">
        <MagnifyingGlass size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' && hits[0] ? pick(hits[0]) : e.key === 'Escape' && setQ(''))} placeholder="Search settings" aria-label="Search settings" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
      </label>
      {q.trim() && (
        <div className="flex flex-col gap-px">
          {hits.length === 0 && <p className="px-2 py-2 text-xs text-ink-3">No setting matches.</p>}
          {hits.map((e) => (
            <button key={`${e.section}/${e.label}`} onClick={() => pick(e)} className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-raised">
              <span className="text-[13px]">{e.label}</span>
              <span className="kicker">{sections.find((s) => s.id === e.section)!.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export function SettingsView({ section }: { section: SettingsSection }) {
  const go = useStore((s) => s.go)
  const focus = useStore((s) => (s.view.name === 'settings' ? s.view.focus : undefined))
  const content = useRef<HTMLDivElement>(null)
  // Search result opened: bring the setting into view and flash it.
  useEffect(() => {
    if (!focus) return
    const el = [...(content.current?.querySelectorAll<HTMLElement>('[data-setting]') ?? [])].find((x) => x.dataset.setting === focus)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }, [focus, section])
  return (
    <>
      <PageHeader kicker="Settings" title={sections.find((s) => s.id === section)!.label} />
      <div className="flex min-h-0 flex-1 gap-9">
        <nav className="flex w-52 shrink-0 flex-col gap-px">
          <SettingsSearch onPick={(e) => go({ name: 'settings', section: e.section, focus: e.label })} />
          {sections.map((s) => (
            <button key={s.id} aria-current={s.id === section ? 'page' : undefined} onClick={() => go({ name: 'settings', section: s.id })} className={`flex items-center gap-2.5 rounded-md py-2 pr-2.5 pl-1 text-left ${s.id === section ? 'bg-raised font-semibold' : 'text-ink-2 hover:text-ink'}`}>
              <span className="w-1.5">{s.id === section && <Led on />}</span>
              {s.icon} {s.label}
            </button>
          ))}
        </nav>
        <div ref={content} className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {section === 'appearance' && <Appearance />}
          {section === 'themes' && <Themes />}
          {section === 'sources' && <SourcesView />}
          {section === 'shield' && <ShieldSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'advanced' && <AdvancedSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </>
  )
}

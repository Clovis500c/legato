import { Check, CheckCircle, ClipboardText, Copy, DownloadSimple, Image, MagicWand, Plus, Trash, UploadSimple, WarningCircle, X } from '@phosphor-icons/react'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { coverImage } from '../../shared/art'
import { msg, tr } from '../../shared/i18n/i18n'
import { contrastReport, FITS, FONTS, isVideo, LOOK_KEYS, lookOf, MAX_THEME_CSS, paletteFrom, PALETTE_KEYS, PRESETS, RADII, sanitizeTheme, type Background, type Palette, type PaletteKey, type Theme } from '../../shared/theme/theme'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton, Segmented, Toggle } from '../../shared/ui/controls'

const fail = (e: unknown) => useStore.getState().notify(String(e), { kind: 'error' })

/** Mini window drawn in the theme's own colors (and picture). */
function ThemeThumb({ t }: { t: Palette & Partial<Pick<Theme, 'background' | 'radius'>> }) {
  const r = t.radius === 'sharp' ? 1 : t.radius === 'round' ? 5 : 3
  const see = (c: string) => (t.background ? `color-mix(in srgb, ${c} ${t.background.panels}%, transparent)` : c)
  return (
    <span className="relative block h-23 w-full overflow-hidden" style={{ background: t.bg }}>
      {t.background &&
        (isVideo(t.background.image) ? (
          // First frame only: a thumbnail grid of playing videos would cost too much.
          <video src={`${coverImage(t.background.image)}#t=0.1`} muted preload="metadata" aria-hidden className="absolute inset-0 size-full object-cover" style={{ filter: `blur(${t.background.blur / 4}px)` }} />
        ) : (
          <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${coverImage(t.background.image)}")`, filter: `blur(${t.background.blur / 4}px)` }} />
        ))}
      {t.background && <span className="absolute inset-0" style={{ background: `color-mix(in srgb, ${t.bg} ${t.background.dim}%, transparent)` }} />}
      <span className="absolute inset-y-0 left-0 w-[24%]" style={{ background: see(t.panel) }} />
      <span className="absolute top-3 left-[5%] size-1.5 rounded-full" style={{ background: t.accent }} />
      {[0, 1, 2].map((i) => (
        <span key={i} className="absolute left-[5%] h-[3px] w-[13%] rounded-full" style={{ top: 12 + i * 8, marginLeft: i ? 0 : 9, background: i ? t.ink4 : t.ink }} />
      ))}
      <span className="absolute top-3 left-[30%] h-1.5 w-[32%] rounded-full" style={{ background: t.ink }} />
      {[0, 1, 2].map((i) => (
        <span key={i} className="absolute left-[30%] flex w-[64%] items-center gap-1.5" style={{ top: 25 + i * 13 }}>
          <span className="size-2.5 shrink-0" style={{ background: t.recess, borderRadius: r }} />
          <span className="h-[3px] rounded-full" style={{ width: `${55 - i * 12}%`, background: i === 1 ? t.accent : t.ink2 }} />
        </span>
      ))}
      <span className="absolute inset-x-0 bottom-0 h-5" style={{ background: see(t.panel), borderTop: `1px solid ${t.line}` }} />
      <span className="absolute bottom-1 left-1/2 size-3 -translate-x-1/2 rounded-full" style={{ background: t.accent }} />
    </span>
  )
}

function ThemeCard({ t, on, onClick, badge }: { t: Theme; on: boolean; onClick: () => void; badge?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className="flex flex-col gap-2 text-left">
      <span className={`block overflow-hidden rounded-lg border-2 ${on ? 'border-ink' : 'border-transparent outline outline-1 outline-line'}`}>
        <ThemeThumb t={t} />
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {on && <Led on />} <span className="flex-1 truncate">{t.name}</span>
        <span className="font-mono text-[0.625rem] text-ink-3">{badge ?? t.accent}</span>
      </span>
    </button>
  )
}

const slotLabels: Record<PaletteKey, string> = { bg: msg('Background'), panel: msg('Panel'), raised: msg('Surface'), recess: msg('Recess (readouts)'), line: msg('Lines'), lineSoft: msg('Soft lines'), ink: msg('Text'), ink2: msg('Secondary text'), ink3: msg('Muted text'), ink4: msg('Decor'), accent: msg('Accent'), onAccent: msg('Icon on accent'), ledOff: msg('LED off') }

function ColorSlot({ k, value, onChange }: { k: PaletteKey; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <label className="flex items-center gap-3 px-1 py-1.5">
      <span className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line" style={{ background: value }}>
        <input type="color" aria-label={tr(slotLabels[k])} value={value} onChange={(e) => (onChange(e.target.value.toUpperCase()), setDraft(e.target.value.toUpperCase()))} className="absolute inset-0 cursor-pointer opacity-0" />
      </span>
      <span className="flex-1 text-xs">{tr(slotLabels[k])}</span>
      <input
        value={draft}
        aria-label={tr('{name}, hex code', { name: tr(slotLabels[k]) })}
        onChange={(e) => {
          setDraft(e.target.value)
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase())
        }}
        className="w-20 rounded border border-line-soft bg-transparent px-1.5 py-0.5 font-mono text-[0.625rem] uppercase"
      />
    </label>
  )
}

function Range({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0 text-ink-2">{label}</span>
      <input type="range" aria-label={label} min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="bar flex-1" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${((value - min) / (max - min)) * 100}%, var(--line) 0)` }} />
      <span className="w-12 text-right font-mono tabular-nums">
        {value}
        {unit}
      </span>
    </label>
  )
}

const TABS = [
  { value: 'colors', label: msg('Colors') },
  { value: 'picture', label: msg('Picture') },
  { value: 'shape', label: msg('Shape and type') },
  { value: 'look', label: msg('Look') },
  { value: 'css', label: msg('CSS') },
] as const
type Tab = (typeof TABS)[number]['value']

const lookLabels: Record<(typeof LOOK_KEYS)[number], string> = {
  covers: msg('Covers'),
  density: msg('List density'),
  readout: msg('Source icon'),
  volume: msg('Volume control'),
  tuner: msg('Tuner scale'),
  tint: msg('Cover tint'), appTint: msg('Whole app in the cover’s color'),
  immersive: msg('Immersive player'),
  backdropBlur: msg('Backdrop blur'),
  backdropDim: msg('Backdrop dim'),
  backdropMotion: msg('Backdrop motion'),
  motion: msg('Animations'),
  sidebarCounts: msg('Counts in the sidebar'),
  listCovers: msg('Covers in lists'),
  columns: msg('List columns'),
}

/** Backgrounds still used by a theme after this change. */
const used = (themes: Theme[]) => new Set(themes.map((t) => t.background?.image).filter(Boolean))

function ThemeEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { settings, update } = useSettings()
  const [tab, setTab] = useState<Tab>('colors')
  const [copied, setCopied] = useState(false)
  const [seed, setSeed] = useState<string>()
  const t = settings.customThemes.find((x) => x.id === id)
  if (!t) return null
  const save = (patch: Partial<Theme>) => {
    const next = settings.customThemes.map((x) => (x.id === id ? (sanitizeTheme({ ...x, ...patch }) ?? x) : x))
    // A picture no theme uses any more: removed from disk.
    const before = t.background?.image
    if (before && !used(next).has(before)) void api.forgetBackground(before).catch(() => {})
    update({ customThemes: next })
  }
  const bg = (patch: Partial<Background>) => t.background && save({ background: { ...t.background, ...patch } })
  const pickPicture = async () => {
    const file = await open({ filters: [{ name: tr('Pictures and videos'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }] })
    if (typeof file !== 'string') return
    try {
      const image = await api.saveBackground(file)
      save({ background: { image, fit: t.background?.fit ?? 'cover', dim: t.background?.dim ?? 35, blur: t.background?.blur ?? 0, panels: t.background?.panels ?? 80 } })
    } catch (e) {
      fail(e)
    }
  }
  const exportFile = async () => {
    const path = await saveDialog({ defaultPath: `${t.name}.theme`, filters: [{ name: 'Legato theme', extensions: ['theme'] }] })
    if (path) await api.exportTheme(path, t).then(() => useStore.getState().notify(tr('Theme saved'), { kind: 'ok' }), fail)
  }
  const report = contrastReport(t)
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-raised p-4.5">
      <div className="flex items-center gap-3">
        <span className="size-6.5 rounded-full border-[5px]" style={{ background: t.accent, borderColor: t.bg }} />
        <input value={t.name} aria-label={tr('Theme name')} maxLength={40} onChange={(e) => save({ name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-lg font-bold tracking-tight outline-none" />
        <Button onClick={() => update({ theme: t.id, ...t.look })} disabled={settings.theme === t.id}>
          {settings.theme === t.id ? tr('Applied') : tr('Apply')}
        </Button>
        <RoundButton label={tr('Save as a .theme file')} onClick={() => void exportFile()}>
          <DownloadSimple size={15} />
        </RoundButton>
        <RoundButton
          label={copied ? tr('Copied to clipboard') : tr('Copy as text (without the picture)')}
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
          label={tr('Delete theme')}
          onClick={() => {
            const rest = settings.customThemes.filter((x) => x.id !== id)
            if (t.background && !used(rest).has(t.background.image)) void api.forgetBackground(t.background.image).catch(() => {})
            update({ customThemes: rest, ...(settings.theme === id ? { theme: 'system' } : {}) })
            onClose()
          }}
        >
          <Trash size={15} />
        </RoundButton>
        <RoundButton label={tr('Close editor')} kind="plain" size="xs" onClick={onClose}>
          <X size={14} />
        </RoundButton>
      </div>
      <Segmented label={tr('Theme part')} value={tab} onChange={setTab} options={TABS.map((x) => ({ value: x.value, label: tr(x.label) }))} />

      {tab === 'colors' && (
        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-5">
          <div className="grid grid-cols-2 gap-x-4 divide-line-soft">
            {PALETTE_KEYS.map((k) => (
              <ColorSlot key={`${k}${t[k]}`} k={k} value={t[k]} onChange={(v) => save({ [k]: v })} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-lg bg-recess p-3">
              <span className="kicker">{tr('From one color')}</span>
              <p className="text-[0.6875rem] text-ink-2">{tr('Every color made from the one you pick, readable text checked.')}</p>
              <div className="flex items-center gap-2">
                <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line" style={{ background: seed ?? t.accent }}>
                  <input type="color" aria-label={tr('Base color')} value={(seed ?? t.accent).toLowerCase()} onChange={(e) => setSeed(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <Button variant="ghost" onClick={() => save(paletteFrom(seed ?? t.accent, false))}>
                  <MagicWand size={13} /> {tr('Light')}
                </Button>
                <Button variant="ghost" onClick={() => save(paletteFrom(seed ?? t.accent, true))}>
                  <MagicWand size={13} /> {tr('Dark')}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-lg bg-recess p-3">
              <span className="kicker">{tr('Contrast · checked live')}</span>
              {report.map((c) => (
                <span key={c.label} className="flex items-center gap-2 text-xs">
                  {c.ok ? <CheckCircle size={14} className="text-ink-2" /> : <WarningCircle size={14} className="text-danger" />}
                  <span className="flex-1">{tr(c.label)}</span>
                  <span className={`font-mono text-[0.625rem] ${c.ok ? 'text-ink-2' : 'text-danger'}`}>
                    {c.ratio.toFixed(1)}:1 {c.ok ? 'AA' : `< ${c.min}`}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'picture' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void pickPicture()}>
              <Image size={14} /> {t.background ? tr('Another picture or video…') : tr('Choose a picture or video…')}
            </Button>
            {t.background && (
              <Button variant="ghost" onClick={() => save({ background: undefined })}>
                {tr('No picture')}
              </Button>
            )}
          </div>
          {t.background ? (
            <>
              {isVideo(t.background.image) && <p className="text-xs text-ink-2">{tr('Plays muted in a loop, still while animations are off or Legato is hidden.')}</p>}
              <Segmented label={tr('Fit')} value={t.background.fit} onChange={(fit) => bg({ fit })} options={FITS.filter((f) => f !== 'tile' || !isVideo(t.background!.image)).map((f) => ({ value: f, label: tr({ cover: msg('Fill'), contain: msg('Fit'), tile: msg('Tile') }[f]) }))} />
              <Range label={tr('Color over it')} value={t.background.dim} min={0} max={90} unit="%" onChange={(dim) => bg({ dim })} />
              <Range label={tr('Blur')} value={t.background.blur} min={0} max={40} unit="px" onChange={(blur) => bg({ blur })} />
              <Range label={tr('Panels')} value={t.background.panels} min={40} max={100} unit="%" onChange={(panels) => bg({ panels })} />
              <p className="text-[0.6875rem] text-ink-3">{tr('The picture stays on this PC (copied into the app); a .theme file carries it along. Sync Mode carries the theme but not its picture.')}</p>
            </>
          ) : (
            <p className="text-xs text-ink-2">{tr('A picture behind the whole window; panels let it show through.')}</p>
          )}
        </div>
      )}

      {tab === 'shape' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{tr('Corners')}</span>
            <Segmented label={tr('Corners')} value={t.radius} onChange={(radius) => save({ radius })} options={RADII.map((r) => ({ value: r, label: tr({ sharp: msg('Sharp'), soft: msg('Soft'), round: msg('Round') }[r]) }))} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{tr('Font')}</span>
            <Segmented label={tr('Font')} value={t.font} onChange={(font) => save({ font })} options={FONTS.map((f) => ({ value: f, label: tr({ modern: msg('Modern'), hifi: msg('Hi-Fi'), neutral: msg('Windows') }[f]) }))} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{tr('LED glow')}</span>
            <Toggle label={tr('LED glow')} checked={t.glow} onChange={(glow) => save({ glow })} />
          </div>
        </div>
      )}

      {tab === 'look' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-2">{tr('A theme can bring its own look: cover shape, density, player and lists. Set them in Appearance below, then keep them here. Picking the theme sets them again.')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => save({ look: lookOf(settings) })}>
              {t.look ? tr('Keep the current look again') : tr('Keep the current look')}
            </Button>
            {t.look && (
              <Button variant="ghost" onClick={() => save({ look: undefined })}>
                {tr('Colors only')}
              </Button>
            )}
          </div>
          {t.look && <p className="text-[0.6875rem] text-ink-3">{Object.keys(t.look).map((k) => tr(lookLabels[k as keyof typeof lookLabels])).join(' · ')}</p>}
        </div>
      )}

      {tab === 'css' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-2">{tr('Your own CSS on top of the theme: any part of the interface. Links and @import are removed; Legato’s name, logo and legal notices stay as they are.')}</p>
          <textarea
            defaultValue={t.css ?? ''}
            key={t.id}
            onBlur={(e) => save({ css: e.target.value })}
            rows={10}
            spellCheck={false}
            maxLength={MAX_THEME_CSS}
            placeholder=".kicker { letter-spacing: 0.2em; }"
            aria-label={tr('Theme CSS')}
            className="rounded-lg border border-line bg-bg p-3 font-mono text-[0.6875rem]"
          />
          <p className="text-[0.6875rem] text-ink-3">{tr('Applied when you leave the field. {n} characters at most.', { n: MAX_THEME_CSS.toLocaleString() })}</p>
        </div>
      )}
    </section>
  )
}

/** Appearance › Theme: pick, make, import and edit themes (custom ones open in the editor). */
export function ThemeStudio() {
  const { settings, update, current } = useSettings()
  const [editing, setEditing] = useState<string>()
  const [pasting, setPasting] = useState(false)
  const [paste, setPaste] = useState('')
  const [bad, setBad] = useState(false)
  const system: Theme = { ...current('system'), name: tr('System') }
  const add = (t: Theme) => {
    update({ customThemes: [...settings.customThemes, t], theme: t.id })
    setEditing(t.id)
  }
  const fresh = (t: Partial<Theme>) => sanitizeTheme({ ...current(), ...t, id: undefined })
  const importFile = async () => {
    const file = await open({ filters: [{ name: 'Legato theme', extensions: ['theme', 'json'] }] })
    if (typeof file !== 'string') return
    try {
      const t = sanitizeTheme({ ...((await api.importTheme(file)) as object), id: undefined })
      if (!t) throw new Error(tr('Invalid theme: all 13 colors are needed, as #RRGGBB.'))
      add(t)
    } catch (e) {
      fail(e)
    }
  }
  const pick = (t: Theme) => update({ theme: t.id, ...t.look })
  return (
    <section data-setting="Theme" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="kicker">
          {tr('Theme')} · {PRESETS.length + 1 + settings.customThemes.length}
        </h2>
        <span className="kicker">{tr('Applied: {name}', { name: current().name })}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
        <ThemeCard t={system} on={settings.theme === 'system'} onClick={() => update({ theme: 'system' })} badge={tr('AUTO')} />
        {PRESETS.map((t) => (
          <ThemeCard key={t.id} t={t} on={settings.theme === t.id} onClick={() => pick(t)} />
        ))}
        {settings.customThemes.map((t) => (
          <ThemeCard
            key={t.id}
            t={t}
            on={settings.theme === t.id}
            badge={tr('CUSTOM')}
            onClick={() => {
              pick(t)
              setEditing(t.id)
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const t = fresh({ name: tr('{name} custom', { name: current().name }) })
            if (t) add(t)
          }}
        >
          <Plus size={14} /> {tr('New theme (copy of current)')}
        </Button>
        <Button variant="ghost" onClick={() => void importFile()}>
          <UploadSimple size={14} /> {tr('Open a .theme file…')}
        </Button>
        <Button variant="ghost" onClick={() => setPasting(!pasting)}>
          <ClipboardText size={14} /> {tr('Paste a theme')}
        </Button>
      </div>
      {pasting && (
        <div className="flex flex-col gap-2">
          <textarea value={paste} onChange={(e) => (setPaste(e.target.value), setBad(false))} rows={5} placeholder={tr('Paste the contents of a .theme file here')} className="rounded-lg border border-line bg-raised p-3 font-mono text-[0.6875rem]" />
          <div className="flex items-center gap-3">
            <Button
              disabled={!paste.trim()}
              onClick={() => {
                let theme: Theme | null = null
                try {
                  // Pasted text: no picture (only files carry one).
                  const raw = JSON.parse(paste)
                  theme = sanitizeTheme({ ...raw, id: undefined, background: undefined })
                } catch {
                  theme = null
                }
                if (!theme) return setBad(true)
                add(theme)
                setPaste('')
                setPasting(false)
              }}
            >
              {tr('Add')}
            </Button>
            {bad && <span className="text-xs text-danger">{tr('Invalid theme: all 13 colors are needed, as #RRGGBB.')}</span>}
          </div>
        </div>
      )}
      {editing && <ThemeEditor key={editing} id={editing} onClose={() => setEditing(undefined)} />}
    </section>
  )
}

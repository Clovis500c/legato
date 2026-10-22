import { ArrowCounterClockwise, CaretRight, Export, FloppyDisk, Plus } from '@phosphor-icons/react'
import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type Effects } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton, Toggle } from '../../shared/ui/controls'
import { editPresetMenu, editVersionMenu, editorMenu } from '../menus'
import { EQ_FREQS, NEUTRAL, neutral, PRESETS } from '../player/effects'
import { useLive } from '../player/live'
import { usePlayer } from '../player/store'
import { applyPreset, bypass, playVersion, presetEffects, renameVersion, reset, savePreset, saveVersion, setEffects, updateVersion, useEditor } from './editor'

/** Range with a resting value (double-click goes back to it). Filled from the start, or from the rest when `center` (bipolar). */
function Slider({ label, value, min, max, step, rest, center = false, show, onChange }: { label: string; value: number; min: number; max: number; step: number; rest: number; center?: boolean; show: (v: number) => string; onChange: (v: number) => void }) {
  const at = (v: number) => ((v - min) / (max - min)) * 100
  const [a, b] = [at(value), center ? at(rest) : 0].sort((x, y) => x - y)
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)_58px] items-center gap-2 text-xs">
      <span className="truncate text-ink-2" title={label}>
        {label}
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={show(value)}
        title={tr('Double-click to reset')}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        onDoubleClick={() => onChange(rest)}
        className="bar handle"
        style={{ backgroundImage: `linear-gradient(to right, var(--line) ${a}%, var(--ink) ${a}%, var(--ink) ${b}%, var(--line) ${b}%)` }}
      />
      <span className={`text-right font-mono tabular-nums ${value === rest ? 'text-ink-3' : 'text-ink'}`}>{show(value)}</span>
    </div>
  )
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-line-soft px-1 pt-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-xs font-semibold">{title}</h3>
        {action}
      </div>
      {hint && <p className="-mt-1.5 text-[0.6875rem] text-ink-3">{hint}</p>}
      {children}
    </section>
  )
}

const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`
const db = (v: number) => `${signed(v, Math.abs(v) < 10 && v % 1 ? 1 : 0)} dB`
const pct = (v: number) => `${Math.round(v * 100)}%`
const times = (v: number) => `×${v.toFixed(2)}`
const hz = (f: number) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`)

/** Top view of the listener: drag the dot to place the sound (direction, distance). Sliders below do the same. */
function SpacePad({ space, spin, onChange }: { space: Effects['space']; spin: boolean; onChange: (p: Partial<Effects['space']>) => void }) {
  const box = useRef<SVGSVGElement>(null)
  const r = 0.2 + ((space.distance - 0.5) / 2.5) * 0.75
  const rad = (space.azimuth * Math.PI) / 180
  const place = (e: React.PointerEvent) => {
    const b = box.current!.getBoundingClientRect()
    const x = ((e.clientX - b.left) / b.width) * 2.4 - 1.2
    const y = ((e.clientY - b.top) / b.height) * 2.4 - 1.2
    const azimuth = Math.round((Math.atan2(x, -y) * 180) / Math.PI)
    const distance = Math.round(Math.min(3, Math.max(0.5, 0.5 + ((Math.hypot(x, y) - 0.2) / 0.75) * 2.5)) * 10) / 10
    onChange({ azimuth, distance })
  }
  return (
    <svg
      ref={box}
      viewBox="-1.2 -1.2 2.4 2.4"
      aria-hidden
      className="size-36 shrink-0 cursor-crosshair touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        place(e)
      }}
      onPointerMove={(e) => e.buttons & 1 && place(e)}
    >
      <circle r="0.95" fill="none" stroke="var(--line)" strokeWidth="0.02" />
      <circle r="0.575" fill="none" stroke="var(--line-soft)" strokeWidth="0.015" strokeDasharray="0.05 0.05" />
      {/* Listener, nose up: 0° is in front. */}
      <circle r="0.12" fill="var(--raised)" stroke="var(--ink-3)" strokeWidth="0.02" />
      <path d="M -0.04 -0.115 L 0 -0.19 L 0.04 -0.115" fill="none" stroke="var(--ink-3)" strokeWidth="0.02" />
      <g style={spin ? { animation: `spin ${space.periodS}s linear infinite`, transformOrigin: '0 0' } : undefined}>
        <line x1="0" y1="0" x2={r * Math.sin(rad)} y2={-r * Math.cos(rad)} stroke="var(--accent)" strokeWidth="0.015" opacity="0.5" />
        <circle cx={r * Math.sin(rad)} cy={-r * Math.cos(rad)} r="0.09" fill="var(--accent)" />
      </g>
    </svg>
  )
}

/** Inline name field (save a version or a preset): Enter saves, Esc cancels. */
function NameField({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial)
  const ok = name.trim().length > 0
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onSave(name.trim())
      }}
    >
      <input autoFocus aria-label={label} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-ink-3" />
      <button type="submit" disabled={!ok} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-bg disabled:opacity-40">
        {tr('Save')}
      </button>
      <button type="button" onClick={onCancel} className="rounded-full px-2 py-1 text-xs text-ink-2 hover:text-ink">
        {tr('Cancel')}
      </button>
    </form>
  )
}

const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-ink text-bg' : 'border border-line text-ink hover:bg-raised'}`

/** Where the editor can't be heard right now, and why. */
function Reach() {
  const via = usePlayer((s) => s.now?.via)
  const liveYoutube = useSettings((s) => s.settings.liveYoutube)
  const error = useLive((s) => s.error)
  const update = useSettings((s) => s.update)
  const note = (text: string, action?: ReactNode) => (
    <p className="flex items-center gap-2 rounded-lg bg-recess px-2.5 py-2 text-[0.6875rem] text-ink-2">
      <span className="flex-1">{text}</span>
      {action}
    </p>
  )
  if (via === 'spotify') return note(tr('Spotify plays in its own app: the Live Editor can’t change its sound. Your settings are kept for this song elsewhere.'))
  if (via === 'youtube' && !liveYoutube)
    return note(
      tr('YouTube’s sound processing is off.'),
      <button onClick={() => update({ liveYoutube: true })} className="shrink-0 font-semibold text-ink underline-offset-2 hover:underline">
        {tr('Turn on')}
      </button>,
    )
  if (via === 'youtube' && error) return note(tr('Not on this video: {error}. It plays as usual.', { error }))
  return null
}

/** Local files only: a copy with the changes, as WAV, next to the original (never touched). */
function ExportCopy({ path, effects }: { path: string; effects: Effects }) {
  const notify = useStore((s) => s.notify)
  // undefined = idle, null = running (length unknown), else 0..1.
  const [progress, setProgress] = useState<number | null>()
  const start = async () => {
    const cut = path.lastIndexOf('.')
    const base = cut > Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) ? path.slice(0, cut) : path
    const out = await save({ defaultPath: `${base} ${tr('(edited)')}.wav`, filters: [{ name: 'WAV', extensions: ['wav'] }] })
    if (!out) return
    setProgress(null)
    const off = api.onExport(setProgress)
    try {
      await api.exportEdit(path, out, effects)
      notify(tr('Copy saved'), { kind: 'ok', action: { label: tr('Show in folder'), run: () => void revealItemInDir(out) } })
    } catch (e) {
      if (String(e) !== 'canceled') notify(tr('Export failed: {error}', { error: String(e) }), { kind: 'error' })
    } finally {
      void off.then((f) => f())
      setProgress(undefined)
    }
  }
  const unchanged = neutral(effects)
  return (
    <Section title={tr('Export')} hint={tr('A copy of this file with your changes, as WAV. The original stays as it is.')}>
      {progress === undefined ? (
        <button disabled={unchanged} onClick={() => void start()} className="flex w-fit items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink hover:bg-raised disabled:opacity-40">
          <Export size={13} /> {unchanged ? tr('Nothing changed yet') : tr('Export a copy…')}
        </button>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <div role="progressbar" aria-label={tr('Exporting')} aria-valuenow={progress === null ? undefined : Math.round(progress * 100)} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <div className={`h-full bg-ink transition-[width] ${progress === null ? 'w-1/3 animate-pulse' : ''}`} style={progress === null ? undefined : { width: `${progress * 100}%` }} />
          </div>
          <span className="w-9 text-right font-mono text-ink-2 tabular-nums">{progress === null ? '…' : pct(progress)}</span>
          <button onClick={() => void api.exportStop()} className="text-ink-2 hover:text-ink">
            {tr('Cancel')}
          </button>
        </div>
      )}
    </Section>
  )
}

/**
 * Now Playing › Live Editor, beside the cover. Changes play at once (local files in the app's engine, YouTube in its
 * player); versions are saved per song and one of them plays whenever the song does. Only numbers are saved.
 */
export function EditorPanel({ onHide }: { onHide: () => void }) {
  const { song, effects: e, versions, presets, versionId, dirty } = useEditor()
  const motion = useSettings((s) => s.settings.motion)
  const playing = usePlayer((s) => s.playing)
  const local = usePlayer((s) => (s.now?.via === 'local' ? s.now.path : undefined))
  const [naming, setNaming] = useState<'version' | 'preset' | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const current = versions.find((v) => v.id === versionId)
  const sub = <K extends 'reverb' | 'echo' | 'space'>(k: K, p: Partial<Effects[K]>) => setEffects({ [k]: { ...e[k], ...p } } as Partial<Effects>)
  const eq = (i: number, g: number) => setEffects({ eq: e.eq.map((x, j) => (j === i ? g : x)) as Effects['eq'] })
  const fail = (err: unknown) => useStore.getState().notify(String(err), { kind: 'error' })

  return (
    <aside aria-label={tr('Live Editor')} onContextMenu={onMenu(() => editorMenu(onHide))} className="flex min-h-0 flex-col gap-2 rounded-2xl border border-line-soft bg-[color-mix(in_srgb,var(--panel)_55%,transparent)] p-3">
      <div className="flex items-center gap-2 px-1">
        <span className="flex-1 text-[0.8125rem] font-semibold">{tr('Live Editor')}</span>
        <span className="text-[0.6875rem] text-ink-3">{e.on ? tr('Edited') : tr('Original sound')}</span>
        <Toggle label={tr('Hear the changes (off: the song as is)')} checked={e.on} onChange={bypass} />
        <RoundButton label={tr('Reset all')} kind="plain" size="sm" onClick={reset}>
          <ArrowCounterClockwise size={14} />
        </RoundButton>
        <RoundButton label={tr('Hide the Live Editor')} kind="plain" size="sm" onClick={onHide}>
          <CaretRight size={14} />
        </RoundButton>
      </div>

      <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-2">
        <Reach />

        {/* Versions of this song: one plays whenever the song does. */}
        {song && (
          <section className="flex flex-col gap-2 px-1">
            <h3 className="text-xs font-semibold">{tr('Versions of this song')}</h3>
            <div role="radiogroup" aria-label={tr('Versions of this song')} className="flex flex-wrap gap-1.5">
              <button role="radio" aria-checked={versionId === null} onClick={() => playVersion(null).catch(fail)} className={chip(versionId === null)}>
                {tr('Original')}
              </button>
              {versions.map((v) =>
                renaming === v.id ? null : (
                  <button key={v.id} role="radio" aria-checked={versionId === v.id} onClick={() => playVersion(v.id).catch(fail)} onContextMenu={onMenu(() => editVersionMenu(v, () => setRenaming(v.id)))} className={chip(versionId === v.id)}>
                    {v.name}
                  </button>
                ),
              )}
            </div>
            {renaming !== null && (
              <NameField
                key={renaming}
                label={tr('Version name')}
                initial={versions.find((v) => v.id === renaming)?.name ?? ''}
                onSave={(name) => {
                  setRenaming(null)
                  renameVersion(renaming, name).catch(fail)
                }}
                onCancel={() => setRenaming(null)}
              />
            )}
            {naming === 'version' ? (
              <NameField
                label={tr('Version name')}
                initial={tr('Version {n}', { n: versions.length + 1 })}
                onSave={(name) => {
                  setNaming(null)
                  saveVersion(name).catch(fail)
                }}
                onCancel={() => setNaming(null)}
              />
            ) : (
              dirty && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {current && (
                    <button onClick={() => updateVersion().catch(fail)} className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-medium text-bg">
                      <FloppyDisk size={13} /> {tr('Save “{name}”', { name: current.name })}
                    </button>
                  )}
                  <button onClick={() => setNaming('version')} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${current ? 'border border-line text-ink hover:bg-raised' : 'bg-ink text-bg'}`}>
                    <Plus size={13} /> {tr('Save as a version')}
                  </button>
                </div>
              )
            )}
          </section>
        )}

        <Section
          title={tr('Presets')}
          action={
            naming !== 'preset' && (
              <button onClick={() => setNaming('preset')} className="text-[0.6875rem] font-medium text-ink-2 hover:text-ink">
                {tr('Save as preset')}
              </button>
            )
          }
        >
          {naming === 'preset' && (
            <NameField
              label={tr('Preset name')}
              initial={tr('My preset')}
              onSave={(name) => {
                setNaming(null)
                savePreset(name).catch(fail)
              }}
              onCancel={() => setNaming(null)}
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => applyPreset(p.effects)} onContextMenu={onMenu(() => editPresetMenu(tr(p.name), () => applyPreset(p.effects)))} className={chip(false)}>
                {tr(p.name)}
              </button>
            ))}
            {presets.map((p) => (
              <button key={p.id} onClick={() => applyPreset(presetEffects(p))} onContextMenu={onMenu(() => editPresetMenu(p.name, () => applyPreset(presetEffects(p)), p.id))} className={chip(false)}>
                {p.name}
              </button>
            ))}
          </div>
        </Section>

        <Section title={tr('Speed and pitch')} hint={tr('Speed changes both, like a record (slowed, sped up). Tempo keeps the pitch; pitch keeps the tempo.')}>
          <Slider center label={tr('Speed')} value={e.speed} min={0.5} max={1.5} step={0.01} rest={1} show={times} onChange={(speed) => setEffects({ speed })} />
          <Slider center label={tr('Tempo')} value={e.tempo} min={0.5} max={1.5} step={0.01} rest={1} show={times} onChange={(tempo) => setEffects({ tempo })} />
          <Slider center label={tr('Pitch')} value={e.pitch} min={-12} max={12} step={0.5} rest={0} show={(v) => tr('{n} st', { n: signed(v, v % 1 ? 1 : 0) })} onChange={(pitch) => setEffects({ pitch })} />
        </Section>

        <Section title={tr('Tone')}>
          <Slider label={tr('Bass boost')} value={e.bass} min={0} max={12} step={0.5} rest={0} show={db} onChange={(bass) => setEffects({ bass })} />
          {EQ_FREQS.map((f, i) => (
            <Slider key={f} center label={hz(f)} value={e.eq[i]} min={-12} max={12} step={0.5} rest={0} show={db} onChange={(g) => eq(i, g)} />
          ))}
        </Section>

        <Section title={tr('Reverb and echo')}>
          <Slider label={tr('Reverb')} value={e.reverb.mix} min={0} max={1} step={0.01} rest={0} show={pct} onChange={(mix) => sub('reverb', { mix })} />
          {e.reverb.mix > 0 && (
            <>
              <Slider label={tr('Room size')} value={e.reverb.size} min={0} max={1} step={0.01} rest={NEUTRAL.reverb.size} show={pct} onChange={(size) => sub('reverb', { size })} />
              <Slider label={tr('Softness')} value={e.reverb.damping} min={0} max={1} step={0.01} rest={NEUTRAL.reverb.damping} show={pct} onChange={(damping) => sub('reverb', { damping })} />
              <Slider label={tr('Pre-delay')} value={e.reverb.predelayMs} min={0} max={100} step={1} rest={NEUTRAL.reverb.predelayMs} show={(v) => `${v} ms`} onChange={(predelayMs) => sub('reverb', { predelayMs })} />
            </>
          )}
          <Slider label={tr('Echo')} value={e.echo.mix} min={0} max={1} step={0.01} rest={0} show={pct} onChange={(mix) => sub('echo', { mix })} />
          {e.echo.mix > 0 && (
            <>
              <Slider label={tr('Echo time')} value={e.echo.timeMs} min={50} max={1000} step={10} rest={NEUTRAL.echo.timeMs} show={(v) => `${v} ms`} onChange={(timeMs) => sub('echo', { timeMs })} />
              <Slider label={tr('Repeats')} value={e.echo.feedback} min={0} max={0.85} step={0.01} rest={NEUTRAL.echo.feedback} show={pct} onChange={(feedback) => sub('echo', { feedback })} />
            </>
          )}
        </Section>

        <Section title={tr('3D sound')} hint={tr('Where the sound comes from, for headphones. Turning it makes an 8D song.')} action={<Toggle label={tr('3D sound')} checked={e.space.on} onChange={(on) => sub('space', { on })} />}>
          {e.space.on && (
            <>
              <div className="flex items-center gap-3">
                <SpacePad space={e.space} spin={e.space.rotate && motion && playing && e.on} onChange={(p) => sub('space', p)} />
                <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-ink-2">{tr('Turn around you')}</span>
                    <Toggle label={tr('Turn around you')} checked={e.space.rotate} onChange={(rotate) => sub('space', { rotate })} />
                  </label>
                  <p className="text-[0.6875rem] text-ink-3">{tr('Drag the dot to move the sound.')}</p>
                </div>
              </div>
              <Slider center label={tr('Direction')} value={e.space.azimuth} min={-180} max={180} step={1} rest={0} show={(v) => `${v}°`} onChange={(azimuth) => sub('space', { azimuth })} />
              <Slider center label={tr('Height')} value={e.space.elevation} min={-40} max={40} step={1} rest={0} show={(v) => `${v}°`} onChange={(elevation) => sub('space', { elevation })} />
              <Slider label={tr('Distance')} value={e.space.distance} min={0.5} max={3} step={0.1} rest={1} show={(v) => `${v.toFixed(1)} m`} onChange={(distance) => sub('space', { distance })} />
              {e.space.rotate && <Slider label={tr('One turn')} value={e.space.periodS} min={2} max={30} step={1} rest={NEUTRAL.space.periodS} show={(v) => `${v} s`} onChange={(periodS) => sub('space', { periodS })} />}
              <Slider label={tr('Room')} value={e.space.room} min={0} max={1} step={0.01} rest={NEUTRAL.space.room} show={pct} onChange={(room) => sub('space', { room })} />
            </>
          )}
        </Section>

        <Section title={tr('Dynamics')}>
          <Slider label={tr('Compressor')} value={e.compress} min={0} max={1} step={0.01} rest={0} show={pct} onChange={(compress) => setEffects({ compress })} />
        </Section>

        <Section title={tr('Stereo')}>
          <Slider center label={tr('Width')} value={e.width} min={0} max={2} step={0.01} rest={1} show={(v) => (v === 0 ? tr('Mono') : pct(v))} onChange={(width) => setEffects({ width })} />
          <Slider center label={tr('Balance')} value={e.balance} min={-1} max={1} step={0.01} rest={0} show={(v) => (v === 0 ? tr('Center') : v < 0 ? tr('{n}% left', { n: Math.round(-v * 100) }) : tr('{n}% right', { n: Math.round(v * 100) }))} onChange={(balance) => setEffects({ balance })} />
        </Section>
        {local && <ExportCopy path={local} effects={e} />}
        <p className="px-1 text-[0.6875rem] text-ink-3">{tr('Only these settings are saved, never the sound itself.')}</p>
      </div>
    </aside>
  )
}

import { ShortcutsSection } from './ShortcutsSection'
import { ArrowCounterClockwise, ArrowsClockwise, Check, Info, Keyboard, MagnifyingGlass, PaintBrush, Plugs, Plus, ShieldCheck, Sliders } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore, type SettingsSection } from '../../app/store'
import { api } from '../../shared/api'
import { formatCount } from '../../shared/format'
import { ACCENTS, ADAPTIVE_LEVELS, COLUMNS, DEFAULTS, type AdaptiveLevel, type Column, type Settings } from '../../shared/theme/theme'
import { Button } from '../../shared/ui/Button'
import { Led, Segmented, Toggle } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { curveLabels } from '../player/fade'
import { usePlayer } from '../player/store'
import { useLive } from '../player/live'
import { SourcesView } from '../sources/SourcesView'
import { SyncSection } from '../syncmode/SyncSection'
import { AboutSection } from './AboutSection'
import { ThemeStudio } from './ThemeStudio'
import { FadeEditor } from './FadeEditor'
import { CountsScene, CoverShapes, DensityScene, FadeScene, ListCoversScene, MiniPlayerScene, MixCoverScene, MotionScene, NowPlayingScene, SourceIconScene, TunerScene, VolumeScene } from './previews'
import { searchSettings, type SettingEntry } from './search'
import { LANGUAGES, msg, resolveLang, tr } from '../../shared/i18n/i18n'
import { ask } from '../../shared/ui/Ask'

const sections: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: msg('Appearance'), icon: <PaintBrush size={15} /> },
  { id: 'sources', label: msg('Accounts'), icon: <Plugs size={15} /> },
  { id: 'sync', label: msg('Sync Mode'), icon: <ArrowsClockwise size={15} /> },
  { id: 'shield', label: msg('Shield'), icon: <ShieldCheck size={15} /> },
  { id: 'shortcuts', label: msg('Shortcuts'), icon: <Keyboard size={15} /> },
  { id: 'advanced', label: msg('Advanced'), icon: <Sliders size={15} /> },
  { id: 'about', label: msg('About'), icon: <Info size={15} /> },
]

/** title: English, the setting's id (search, data-setting); shown translated. */
function Group({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: ReactNode }) {
  return (
    <section data-setting={title} className="flex flex-col gap-2.5 rounded-lg">
      <div className="flex items-center justify-between">
        <h2 className="kicker">
          {tr(title)}
          {count !== undefined && ` · ${count}`}
        </h2>
        {hint && <span className="kicker">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

/** label: English, the setting's id (search, data-setting); shown translated. preview = live picture of what the setting changes. */
function Row({ label, sub, children, preview }: { label: string; sub?: string; children: ReactNode; preview?: ReactNode }) {
  return (
    <div data-setting={label} className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
      <div className="flex-1">
        <p className="text-[13px] font-medium">{tr(label)}</p>
        {sub && <p className="text-xs text-ink-2">{sub}</p>}
      </div>
      {preview}
      {children}
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
    <Group title={msg('Interface size')} hint={`${v}%`}>
      <div className="flex h-8 items-center gap-3">
        <input type="range" aria-label={tr('Interface size')} min={90} max={125} step={5} value={v} onChange={(e) => setDraft(+e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} className="bar w-60" style={{ background: `linear-gradient(to right, var(--ink) ${((v - 90) / 35) * 100}%, var(--line) 0)` }} />
        {draft !== null && draft !== s.zoom && (
          <>
            <Button onClick={apply}>{tr('Apply {n}%', { n: v })}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {tr('Cancel')}
            </Button>
          </>
        )}
      </div>
    </Group>
  )
}

const fonts: { value: Settings['font']; label: string }[] = [
  { value: 'theme', label: msg('Theme') },
  { value: 'modern', label: tr('Modern') },
  { value: 'hifi', label: tr('Hi-Fi') },
  { value: 'neutral', label: tr('Windows') },
]

function Appearance() {
  const { settings: s, update, current } = useSettings()
  const go = useStore((st) => st.go)
  const col = (c: Column) => (s.columns.includes(c) ? s.columns.filter((x) => x !== c) : COLUMNS.filter((x) => x === c || s.columns.includes(x)))
  const labels: Record<Column, string> = { album: msg('Album'), sources: msg('Sources'), duration: msg('Duration') }
  const reset: Partial<Settings> = { accent: DEFAULTS.accent, covers: DEFAULTS.covers, density: DEFAULTS.density, zoom: DEFAULTS.zoom, readout: DEFAULTS.readout, volume: DEFAULTS.volume, tuner: DEFAULTS.tuner, columns: DEFAULTS.columns, tint: DEFAULTS.tint, immersive: DEFAULTS.immersive, miniPlayer: DEFAULTS.miniPlayer, font: DEFAULTS.font, motion: DEFAULTS.motion, sidebarCounts: DEFAULTS.sidebarCounts, listCovers: DEFAULTS.listCovers, clickToPlay: DEFAULTS.clickToPlay, crossfade: DEFAULTS.crossfade, fade: DEFAULTS.fade, youtubeControls: DEFAULTS.youtubeControls, stage: DEFAULTS.stage, miniSpot: DEFAULTS.miniSpot }
  return (
    <div className="flex flex-col gap-7">
      <div className="flex justify-end">
        <Button variant="ghost" onClick={async () => (await ask({ title: tr('Reset appearance?'), body: tr('Every setting on this page goes back to its default, except the theme and the language.'), ok: tr('Reset') })) && update(reset)}>
          <ArrowCounterClockwise size={14} /> {tr('Reset appearance')}
        </Button>
      </div>
      <Group title={msg('Language')}>
        <Segmented
          label={tr('Language')}
          value={s.language}
          onChange={(language) => update({ language })}
          options={[{ value: 'system', label: tr('Windows ({language})', { language: LANGUAGES.find((l) => l.code === resolveLang('system', navigator.languages))!.name }) }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.name }))]}
        />
      </Group>
      <ThemeStudio />
      <Group title={msg('Accent color')} hint={s.accent === 'system' ? tr('from Windows') : (s.accent ?? tr('from theme'))}>
        <div className="flex flex-wrap items-center gap-2">
          {([['system', 'Windows'], [null, msg('Theme')]] as const).map(([value, label]) => (
            <button key={label} onClick={() => update({ accent: value })} aria-pressed={s.accent === value} className={`rounded-full px-3 py-1.5 text-xs font-medium ${s.accent === value ? 'bg-ink text-bg' : 'border border-line'}`}>
              {tr(label)}
            </button>
          ))}
          {ACCENTS.map((c) => (
            <button key={c} aria-label={tr('Accent {color}', { color: c })} aria-pressed={s.accent === c} onClick={() => update({ accent: c })} className={`grid size-8.5 place-items-center rounded-full ${s.accent === c ? 'border-2 border-ink' : ''}`}>
              <span className="size-6 rounded-full" style={{ background: c }} />
            </button>
          ))}
          <label className="grid size-8.5 cursor-pointer place-items-center rounded-full border border-dashed border-ink-3" title={tr('Any color')}>
            <Plus size={12} />
            <input type="color" className="sr-only" value={current().accent.toLowerCase()} onChange={(e) => update({ accent: e.target.value })} />
          </label>
        </div>
      </Group>
      <Group title={msg('Font')} hint={s.font === 'theme' ? tr('theme: {font}', { font: current().font }) : undefined}>
        <Segmented label={tr('Font')} value={s.font} onChange={(font) => update({ font })} options={fonts.map((f) => ({ ...f, label: tr(f.label) }))} />
      </Group>
      <div className="grid grid-cols-2 gap-6">
        <Group title={msg('Covers')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label={tr('Cover shape')} value={s.covers} onChange={(covers) => update({ covers })} options={[{ value: 'net', label: tr('Sharp') }, { value: 'rounded', label: tr('Rounded') }, { value: 'vinyl', label: tr('Vinyl') }]} />
            <CoverShapes covers={s.covers} />
          </div>
        </Group>
        <Group title={msg('List density')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label={tr('Density')} value={s.density} onChange={(density) => update({ density })} options={[{ value: 'compact', label: tr('Compact') }, { value: 'comfort', label: tr('Comfortable') }, { value: 'airy', label: tr('Airy') }]} />
            <DensityScene density={s.density} />
          </div>
        </Group>
      </div>
      <InterfaceSize />
      <Group title={msg('Player')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Source icon')} sub={tr('Where the song plays from, next to the volume')} preview={<SourceIconScene readout={s.readout} />}>
            <Toggle label={tr('Source icon')} checked={s.readout} onChange={(readout) => update({ readout })} />
          </Row>
          <Row label={msg('Volume control')} preview={<VolumeScene volume={s.volume} />}>
            <Segmented label={tr('Volume control')} value={s.volume} onChange={(volume) => update({ volume })} options={[{ value: 'knob', label: tr('Knob') }, { value: 'bar', label: tr('Bar') }]} />
          </Row>
          <Row label={msg('Fade between songs')} preview={!s.fade.advanced && <FadeScene crossfade={s.crossfade} />} sub={s.fade.advanced ? tr('Advanced: {out} s out ({outCurve}), {in} s in ({inCurve})', { out: s.fade.out, outCurve: tr(curveLabels[s.fade.outCurve]), in: s.fade.in, inCurve: tr(curveLabels[s.fade.inCurve]) }) : s.crossfade ? tr('{n} s fade out, then in, when a song ends on its own', { n: s.crossfade }) : tr('No fade')}>
            {s.fade.advanced ? (
              <Button variant="ghost" onClick={() => go({ name: 'settings', section: 'advanced', focus: 'Advanced fade' })}>
                {tr('Edit curves')}
              </Button>
            ) : (
              <input type="range" aria-label={tr('Fade between songs')} min={0} max={12} step={1} value={s.crossfade} onChange={(e) => update({ crossfade: +e.target.value })} className="bar w-40" style={{ background: `linear-gradient(to right, var(--ink) ${(s.crossfade / 12) * 100}%, var(--line) 0)` }} />
            )}
          </Row>
          <Row label={msg('Tuner scale')} sub={tr('Tuner-style progress bar in full screen')} preview={<TunerScene tuner={s.tuner} />}>
            <Toggle label={tr('Tuner scale')} checked={s.tuner} onChange={(tuner) => update({ tuner })} />
          </Row>
          <Row label={msg('Immersive player')} sub={tr("Now Playing over the song's cover, big and blurred")} preview={<NowPlayingScene s={s} />}>
            <Toggle label={tr('Immersive player')} checked={s.immersive} onChange={(immersive) => update({ immersive })} />
          </Row>
          <Row label={msg('Cover tint')} sub={tr('Now Playing takes a flat color from the cover (when immersive is off)')} preview={<NowPlayingScene s={{ ...s, immersive: false }} />}>
            <Toggle label={tr('Cover tint')} checked={s.tint} onChange={(tint) => update({ tint })} />
          </Row>
          <Row label={msg('Mini player')} sub={tr('Floating player for every source. YouTube always shows one: its video must stay visible.')} preview={<MiniPlayerScene miniPlayer={s.miniPlayer} />}>
            <Toggle label={tr('Mini player')} checked={s.miniPlayer} onChange={(miniPlayer) => update({ miniPlayer })} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Lists and navigation')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Covers in lists')} preview={<ListCoversScene listCovers={s.listCovers} />}>
            <Toggle label={tr('Covers in lists')} checked={s.listCovers} onChange={(listCovers) => update({ listCovers })} />
          </Row>
          <Row label={msg('Play with')} sub={tr('On a track row')}>
            <Segmented label={tr('Play with')} value={s.clickToPlay} onChange={(clickToPlay) => update({ clickToPlay })} options={[{ value: 'single', label: tr('One click') }, { value: 'double', label: tr('Double-click') }]} />
          </Row>
          <Row label={msg('Counts in the sidebar')} sub={tr('Number of songs next to each entry')} preview={<CountsScene sidebarCounts={s.sidebarCounts} />}>
            <Toggle label={tr('Counts in the sidebar')} checked={s.sidebarCounts} onChange={(sidebarCounts) => update({ sidebarCounts })} />
          </Row>
          <Row label={msg('Open on')} sub={s.reopen ? tr('Used when “Reopen where you left off” is off (Advanced)') : tr('Screen shown when the app starts')}>
            <Segmented label={tr('Open on')} value={s.startView} onChange={(startView) => update({ startView })} options={[{ value: 'home', label: tr('Home') }, { value: 'songs', label: tr('Songs') }, { value: 'mixes', label: tr('Mixes') }, { value: 'albums', label: tr('Albums') }, { value: 'artists', label: tr('Artists') }]} />
          </Row>
          <Row label={msg('Animations')} sub={tr('Transitions and fades')} preview={<MotionScene motion={s.motion} />}>
            <Toggle label={tr('Animations')} checked={s.motion} onChange={(motion) => update({ motion })} />
          </Row>
        </div>
      </Group>
      <Group title={msg('List columns')}>
        <div className="flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => {
            const on = s.columns.includes(c)
            return (
              <button key={c} aria-pressed={on} onClick={() => update({ columns: col(c) })} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${on ? 'bg-ink text-bg' : 'border border-line text-ink-2'}`}>
                {on ? <Check size={11} /> : <Plus size={11} />} {tr(labels[c])}
              </button>
            )
          })}
        </div>
      </Group>
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
      <p className="text-[13px] text-ink-2">{tr('Blocks ads and trackers with Brave’s engine (adblock-rust) and the EasyList and EasyPrivacy lists, updated every 4 days. In the YouTube player, ad slots are removed before playback.')}</p>
      <div className="rounded-xl border border-line bg-raised">
        <Row label={msg('Block ads and trackers')} sub={tr('Network: right away. YouTube player: on next launch.')}>
          <Toggle
            label={tr('Block ads and trackers')}
            checked={settings.shield}
            onChange={(shield) => {
              update({ shield })
              void api.setShield(shield)
              setChanged(true)
            }}
          />
        </Row>
        <Row label={msg('Blocked requests')} sub={tr('Since app launch')}>
          <span className="font-mono text-2xl tabular-nums">{formatCount(blocked)}</span>
        </Row>
        <Row label={msg('Lists')} sub={tr('EasyList · EasyPrivacy · built-in rules (offline)')}>
          <span className="flex items-center gap-2 kicker">
            <Led on={settings.shield} /> {settings.shield ? tr('Active') : tr('Inactive')}
          </span>
        </Row>
      </div>
      {changed && (
        <div className="flex items-center gap-4 rounded-lg border border-line bg-recess px-4 py-3">
          <p className="flex-1 text-xs">{tr('Restart the app to apply the change to the YouTube player.')}</p>
          <Button onClick={() => void api.restartApp()}>{tr('Restart')}</Button>
        </div>
      )}
      <p className="text-xs text-ink-2">{tr('Note: YouTube’s terms forbid blocking ads in its player. Risks: YouTube may restrict your account, and playback breaks when YouTube changes its player. YouTube Premium removes ads without this risk.')}</p>
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
    <Row label={msg('Open at startup')} sub={tr('Opens when you sign in to Windows. Also in Task Manager › Startup apps')}>
      <Toggle label={tr('Open at startup')} checked={on} onChange={change} />
    </Row>
  )
}

const levelLabels: Record<AdaptiveLevel, string> = { [-20]: msg('Quiet'), [-14]: msg('Normal'), [-11]: msg('Loud') }

/** Live processing of what plays (player/live.ts): local files and previews in the app's engine, YouTube in its player. */
function SoundGroup() {
  const { settings: s, update } = useSettings()
  const youtubeError = useLive((l) => l.error)
  const used = s.adaptiveSound || s.coverPulse
  return (
    <Group title={msg('Sound processing')}>
      <div className="rounded-xl border border-line bg-raised">
        <Row label={msg('Adaptive Sound')} sub={tr('Loud and quiet songs end up alike, adjusted as they play. A thin line under the volume shows the result. Local files and YouTube; not Spotify (its own app plays it).')}>
          <Toggle label={tr('Adaptive Sound')} checked={s.adaptiveSound} onChange={(adaptiveSound) => update({ adaptiveSound })} />
        </Row>
        {s.adaptiveSound && (
          <Row label={msg('Adaptive Sound level')} sub={tr('Where songs are brought: {lufs} LUFS', { lufs: s.adaptiveLevel })}>
            <Segmented
              label={tr('Adaptive Sound level')}
              value={String(s.adaptiveLevel)}
              onChange={(v) => update({ adaptiveLevel: Number(v) as AdaptiveLevel })}
              options={ADAPTIVE_LEVELS.map((l) => ({ value: String(l), label: tr(levelLabels[l]) }))}
            />
          </Row>
        )}
        <Row label={msg('Moving cover')} sub={s.motion ? tr('In Now Playing, the cover swells and settles with the music') : tr('Needs Animations on (Appearance)')}>
          <Toggle label={tr('Moving cover')} checked={s.coverPulse} onChange={(coverPulse) => update({ coverPulse })} />
        </Row>
        <Row
          label={msg("Process YouTube's sound")}
          sub={
            !s.liveYoutube
              ? tr('Off: YouTube plays untouched; the features above and the Live Editor work on local files only')
              : used && youtubeError
                ? tr('Not on this video: {error}. It plays as usual.', { error: youtubeError })
                : tr('Only while the features above or the Live Editor are in use; otherwise YouTube plays untouched. Nothing is recorded or saved, and the video plays as usual if this fails.')
          }
        >
          <Toggle label={tr("Process YouTube's sound")} checked={s.liveYoutube} onChange={(liveYoutube) => update({ liveYoutube })} />
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
      <Group title={msg('Fade between songs')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Advanced fade')} sub={s.fade.advanced ? tr('Your own lengths and shapes, below') : tr('Off: {fade} (Appearance › Player)', { fade: s.crossfade ? tr('{n} s each way, S-curve', { n: s.crossfade }) : tr('no fade') })}>
            <Toggle label={tr('Advanced fade')} checked={s.fade.advanced} onChange={(advanced) => update({ fade: { ...s.fade, advanced } })} />
          </Row>
        </div>
        {s.fade.advanced && <FadeEditor />}
      </Group>
      <SoundGroup />
      <Group title={msg('Immersive player')}>
        <div className="rounded-xl border border-line bg-raised">
          <div className="flex items-center gap-5 border-b border-line-soft p-4">
            <NowPlayingScene s={{ ...s, immersive: true }} big />
            <p className="max-w-48 text-xs text-ink-2">
              {s.immersive ? tr('Live preview: move the sliders and watch the background change.') : tr('Immersive player is off (Appearance › Player): this is how it would look.')}
              {playing ? '' : ` ${tr('Play a song to see it with its own cover.')}`}
            </p>
          </div>
          <Row label={msg('Background blur')} sub={s.backdropBlur ? `${s.backdropBlur} px` : tr('No blur')}>
            <Slider label={tr('Background blur')} value={s.backdropBlur} max={80} onChange={(backdropBlur) => update({ backdropBlur })} />
          </Row>
          <Row label={msg('Background dimming')} sub={tr('{n} %: veil in the theme’s color, keeps text readable', { n: s.backdropDim })}>
            <Slider label={tr('Background dimming')} value={s.backdropDim} max={80} onChange={(backdropDim) => update({ backdropDim })} />
          </Row>
          <Row label={msg('Background motion')} sub={tr('The cover drifts slowly behind the player')}>
            <Toggle label={tr('Background motion')} checked={s.backdropMotion} onChange={(backdropMotion) => update({ backdropMotion })} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Mixes')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Mix covers')} sub={tr("Four of the mix's song covers like playlists, the first one, or the plain numbered tile")} preview={<MixCoverScene mixCovers={s.mixCovers} />}>
            <Segmented
              label={tr('Mix covers')}
              value={s.mixCovers}
              onChange={(mixCovers) => update({ mixCovers })}
              options={[
                { value: 'grid', label: tr('Grid of 4') },
                { value: 'single', label: tr('Single') },
                { value: 'template', label: tr('Template') },
              ]}
            />
          </Row>
        </div>
      </Group>
      <div className="rounded-xl border border-line bg-raised">
        <OpenAtStartup />
        <Row label={msg('Keep running in the notification area')} sub={s.closeToTray ? tr('Closing the window keeps the music going; Quit from the icon’s menu') : tr('Closing the window quits the app')}>
          <Toggle label={tr('Keep running in the notification area')} checked={s.closeToTray} onChange={(closeToTray) => update({ closeToTray })} />
        </Row>
        <Row label={msg('Reopen where you left off')} sub={tr('Same screen as when the app closed, Now Playing open if it was')}>
          <Toggle label={tr('Reopen where you left off')} checked={s.reopen} onChange={(reopen) => update({ reopen })} />
        </Row>
        <Row label={msg('Resume playback on launch')} sub={tr('The last song picks up where it stopped, with its queue, when the app opens')}>
          <Toggle label={tr('Resume playback on launch')} checked={s.resume} onChange={(resume) => update({ resume })} />
        </Row>
        <Row label={msg('Voice search')} sub={tr('The mic beside the search bar. Windows’ online speech recognition: your voice goes to Microsoft’s service while the mic listens, nothing is kept')}>
          <Toggle label={tr('Voice search')} checked={s.voiceSearch} onChange={(voiceSearch) => update({ voiceSearch })} />
        </Row>
        <Row label={msg('Music Detector')} sub={tr('Identify a song (Add music, or the mic): 10 seconds from the microphone, kept in memory, sent once to AudD with your token, nothing saved')}>
          <Toggle label={tr('Music Detector')} checked={s.detector} onChange={(detector) => update({ detector })} />
        </Row>
        <Row label={msg('Subtitles on videos')} sub={tr('Off: hidden even when your Google account shows them')}>
          <Toggle label={tr('Subtitles on videos')} checked={s.subtitles} onChange={(subtitles) => update({ subtitles })} />
        </Row>
        <Row label={msg('YouTube controls on the video')} sub={tr("YouTube's own title, buttons and hover menu on the video. From the next track.")}>
          <Toggle label={tr('YouTube controls on the video')} checked={s.youtubeControls} onChange={(youtubeControls) => update({ youtubeControls })} />
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
      <label className="mb-2 flex w-full items-center gap-2 rounded-full border border-line px-3 py-1.5 text-ink-3 focus-within:border-ink-3">
        <MagnifyingGlass size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' && hits[0] ? pick(hits[0]) : e.key === 'Escape' && setQ(''))} placeholder={tr('Search settings')} aria-label={tr('Search settings')} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
      </label>
      {q.trim() && (
        <div className="flex flex-col gap-px">
          {hits.length === 0 && <p className="px-2 py-2 text-xs text-ink-3">{tr('No setting matches.')}</p>}
          {hits.map((e) => (
            <button key={`${e.section}/${e.label}`} onClick={() => pick(e)} className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-raised">
              <span className="text-[13px]">{tr(e.label)}</span>
              <span className="kicker">{tr(sections.find((s) => s.id === e.section)!.label)}</span>
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
      <PageHeader kicker={tr('Settings')} title={tr(sections.find((s) => s.id === section)!.label)} />
      {/* Narrow (small window, or the connect wizard beside it): sections in rows above the page, not a squeezed column. */}
      <div className="@container flex min-h-0 flex-1 flex-col gap-4 @2xl:flex-row @2xl:gap-9">
        <nav className="flex shrink-0 flex-wrap gap-px @2xl:w-52 @2xl:flex-col @2xl:flex-nowrap">
          <SettingsSearch onPick={(e) => go({ name: 'settings', section: e.section, focus: e.label })} />
          {sections.map((s) => (
            <button key={s.id} aria-current={s.id === section ? 'page' : undefined} onClick={() => go({ name: 'settings', section: s.id })} className={`flex items-center gap-2.5 rounded-md py-2 pr-2.5 pl-1 text-left ${s.id === section ? 'bg-raised font-semibold' : 'text-ink-2 hover:text-ink'}`}>
              <span className="w-1.5">{s.id === section && <Led on />}</span>
              {s.icon} {tr(s.label)}
            </button>
          ))}
        </nav>
        <div ref={content} className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {section === 'appearance' && <Appearance />}
          {section === 'sources' && <SourcesView />}
          {section === 'sync' && <SyncSection />}
          {section === 'shield' && <ShieldSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'advanced' && <AdvancedSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </>
  )
}

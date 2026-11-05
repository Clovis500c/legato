import { ShortcutsSection } from './ShortcutsSection'
import { ArrowCounterClockwise, ArrowSquareOut, ArrowsClockwise, CaretDown, Check, Copy, Fingerprint, GearSix, Info, Keyboard, MagnifyingGlass, PaintBrush, Plugs, Plus, ShieldCheck, SpeakerHigh } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore, type SettingsSection } from '../../app/store'
import { api, type Contact } from '../../shared/api'
import { pickFile, saveFile } from '../../shared/files'
import { formatBytes, formatCount, timeAgo } from '../../shared/format'
import { PRIVACY_PAGE } from '../../shared/links'
import { byVia, countText, VIA_LABELS, WHY_LABELS } from './privacy'
import { ACCENTS, ADAPTIVE_LEVELS, COLUMNS, COVER_CACHE_MB, DEFAULTS, DJ_FRESH, DJ_GAPS, VIZ_BANDINGS, VIZ_COLORMAPS, VIZ_COLORS, VIZ_FACES, VIZ_GRADIENTS, VIZ_PRESET_COLORS, VIZ_WEIGHTINGS, type AdaptiveLevel, type Alarm, type Column, type Settings } from '../../shared/theme/theme'
import { Button } from '../../shared/ui/Button'
import { Led, Segmented, Toggle } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { onMenu } from '../../shared/ui/ContextMenu'
import { curveLabels } from '../player/fade'
import { usePlayer } from '../player/store'
import { useLive } from '../player/live'
import { VIZ_BANDING_LABELS, VIZ_COLOR_LABELS, VIZ_COLORMAP_LABELS, VIZ_FACE_LABELS, VIZ_GRADIENT_LABELS, VIZ_PRESET_COLOR_LABELS, VIZ_WEIGHTING_LABELS } from '../player/vizLooks'
import { exportPreset, importPreset, removePreset } from '../player/presetFiles'
import { presetOptions } from '../player/vizPresets'
import { needleLook } from '../player/vizVu'
import { lookOptions, lookSettings, lookValue, usePluginViz } from '../plugins/pluginViz'
import { SourcesView } from '../sources/SourcesView'
import { SyncSection } from '../syncmode/SyncSection'
import { OverlayPanel, RemotePanel } from '../remote/RemotePanel'
import { clearRecent } from '../search/recent'
import { AboutSection } from './AboutSection'
import { ThemeStudio } from './ThemeStudio'
import { FadeEditor } from './FadeEditor'
import { BrowserScene, CountsScene, CoverShapes, DensityScene, FadeScene, ListCoversScene, MiniPlayerScene, MixCoverScene, MotionScene, NowPlayingScene, ProgressScene, SleepButtonScene, SourceIconScene, TunerScene, VolumeScene } from './previews'
import { searchSettings, type SettingEntry } from './search'
import { locale, msg, tr } from '../../shared/i18n/i18n'
import { nextAlarm } from '../player/alarmTime'
import { phoneApp } from '../../shared/platform'
import { DESKTOP_ONLY, DESKTOP_ONLY_SECTIONS } from './desktopOnly'
import { LanguagePicker } from './LanguagePicker'
import { ask } from '../../shared/ui/Ask'

const sections: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: msg('General'), icon: <GearSix size={15} /> },
  { id: 'playback', label: msg('Playback'), icon: <SpeakerHigh size={15} /> },
  { id: 'appearance', label: msg('Appearance'), icon: <PaintBrush size={15} /> },
  { id: 'sources', label: msg('Accounts'), icon: <Plugs size={15} /> },
  { id: 'sync', label: msg('Sync Mode'), icon: <ArrowsClockwise size={15} /> },
  { id: 'shield', label: msg('Shield'), icon: <ShieldCheck size={15} /> },
  { id: 'privacy', label: msg('Privacy'), icon: <Fingerprint size={15} /> },
  { id: 'shortcuts', label: msg('Shortcuts'), icon: <Keyboard size={15} /> },
  { id: 'about', label: msg('About'), icon: <Info size={15} /> },
]

/** title: English, the setting's id (search, data-setting); shown translated. */
function Group({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: ReactNode }) {
  if (phoneApp && DESKTOP_ONLY.has(title)) return null
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

/**
 * label: English, the setting's id (search, data-setting); shown translated. preview = live picture of what the setting
 * changes. setting = the key it edits: "Reset" shows once it's off its default.
 */
function Row({ label, sub, children, preview, setting }: { label: string; sub?: string; children: ReactNode; preview?: ReactNode; setting?: keyof Settings }) {
  const changed = useSettings((st) => !!setting && JSON.stringify(st.settings[setting]) !== JSON.stringify(DEFAULTS[setting]))
  if (phoneApp && DESKTOP_ONLY.has(label)) return null
  return (
    <div
      data-setting={label}
      onContextMenu={onMenu(() => [
        setting && { label: tr('Back to the default'), icon: <ArrowCounterClockwise size={16} />, disabled: !changed, onSelect: () => useSettings.getState().update({ [setting]: DEFAULTS[setting] }) },
        { label: tr('Copy name'), icon: <Copy size={16} />, onSelect: () => void navigator.clipboard.writeText(tr(label)) },
      ])}
      // A narrow pane (the phone, a small window) keeps the words at least half the row: a wide control goes under them.
      className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0 @max-lg:flex-wrap @max-lg:gap-y-2.5"
    >
      <div className="flex-1 @max-lg:min-w-[55%]">
        <p className="flex items-center gap-2 text-[0.8125rem] font-medium">
          {tr(label)}
          {changed && (
            <button type="button" onClick={() => useSettings.getState().update({ [setting!]: DEFAULTS[setting!] })} title={tr('Back to the default')} className="flex items-center gap-1 rounded-full bg-raised px-2 py-px text-[0.6875rem] font-normal text-ink-2 hover:text-ink">
              <ArrowCounterClockwise size={11} /> {tr('Reset')}
            </button>
          )}
        </p>
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
        <input type="range" aria-label={tr('Interface size')} min={90} max={125} step={5} value={v} onChange={(e) => setDraft(+e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} className="bar w-60" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${((v - 90) / 35) * 100}%, var(--line) 0)` }} />
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
  { value: 'modern', label: msg('Modern') },
  { value: 'hifi', label: msg('Hi-Fi') },
  // Segoe UI: off Windows, the system's own font.
  { value: 'neutral', label: phoneApp ? msg('System') : msg('Windows') },
]

function Appearance() {
  const { settings: s, update, current } = useSettings()
  const playing = usePlayer((p) => !!p.now)
  const col = (c: Column) => (s.columns.includes(c) ? s.columns.filter((x) => x !== c) : COLUMNS.filter((x) => x === c || s.columns.includes(x)))
  const labels: Record<Column, string> = { album: msg('Album'), sources: msg('Sources'), plays: msg('Plays'), rating: msg('Rating'), added: msg('Date added'), duration: msg('Duration') }
  const reset: Partial<Settings> = { accent: DEFAULTS.accent, covers: DEFAULTS.covers, density: DEFAULTS.density, zoom: DEFAULTS.zoom, readout: DEFAULTS.readout, sleepButton: DEFAULTS.sleepButton, volume: DEFAULTS.volume, tuner: DEFAULTS.tuner, columns: DEFAULTS.columns, tint: DEFAULTS.tint, immersive: DEFAULTS.immersive, miniPlayer: DEFAULTS.miniPlayer, font: DEFAULTS.font, motion: DEFAULTS.motion, sidebarCounts: DEFAULTS.sidebarCounts, listCovers: DEFAULTS.listCovers, columnBrowser: DEFAULTS.columnBrowser, stage: DEFAULTS.stage, miniSpot: DEFAULTS.miniSpot, miniPlace: DEFAULTS.miniPlace, textSize: DEFAULTS.textSize }
  return (
    <div className="flex flex-col gap-7">
      <div className="flex justify-end">
        <Button variant="ghost" onClick={async () => (await ask({ title: tr('Reset appearance?'), body: tr('Every setting on this page goes back to its default, except the theme and the language.'), ok: tr('Reset') })) && update(reset)}>
          <ArrowCounterClockwise size={14} /> {tr('Reset appearance')}
        </Button>
      </div>
      <ThemeStudio />
      {/* Only Windows gives an accent to read: no Windows chip on the phone, and one synced from a PC shows the theme's. */}
      <Group title={msg('Accent color')} hint={s.accent === 'system' && !phoneApp ? tr('from Windows') : s.accent === 'cover' ? tr('from the cover') : s.accent && s.accent !== 'system' ? s.accent : tr('from theme')}>
        <div className="flex flex-wrap items-center gap-2">
          {([['system', 'Windows'], [null, msg('Theme')], ['cover', msg('Cover')]] as const).filter(([value]) => !phoneApp || value !== 'system').map(([value, label]) => (
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
      {/* A narrow pane stacks them: side by side, their choices were cut. */}
      <div className="grid grid-cols-2 gap-6 @max-lg:grid-cols-1">
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
      <Group title={msg('Text size')}>
        <Segmented
          label={tr('Text size')}
          value={s.textSize}
          onChange={(textSize) => update({ textSize })}
          options={[
            { value: 'compact', label: tr('Compact') },
            { value: 'normal', label: tr('Normal') },
            { value: 'large', label: tr('Large') },
          ]}
        />
      </Group>
      <InterfaceSize />
      <Group title={msg('Player')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="immersive" label={msg('Immersive player')} sub={tr("Now Playing over the song's cover, big and blurred")} preview={<NowPlayingScene s={s} />}>
            <Toggle label={tr('Immersive player')} checked={s.immersive} onChange={(immersive) => update({ immersive })} />
          </Row>
          <Row setting="tint" label={msg('Cover tint')} sub={tr('Now Playing takes a flat color from the cover (when immersive is off)')} preview={<NowPlayingScene s={{ ...s, immersive: false }} />}>
            <Toggle label={tr('Cover tint')} checked={s.tint} onChange={(tint) => update({ tint })} />
          </Row>
          <Row setting="appTint" label={msg('Whole app in the cover’s color')} sub={tr('While a song plays, every page takes a soft color from its cover. Text stays readable')}>
            <Toggle label={tr('Whole app in the cover’s color')} checked={s.appTint} onChange={(appTint) => update({ appTint })} />
          </Row>
          <Row setting="miniPlayer" label={msg('Mini player')} sub={tr('For every source. YouTube always shows one: its video must stay visible.')} preview={<MiniPlayerScene miniPlayer={s.miniPlayer} />}>
            <Toggle label={tr('Mini player')} checked={s.miniPlayer} onChange={(miniPlayer) => update({ miniPlayer })} />
          </Row>
          <Row label={msg('Mini player place')} sub={tr('In the right panel or the sidebar it never covers the page; floating, drag it anywhere.')}>
            <Segmented
              label={tr('Mini player place')}
              value={s.miniPlace}
              onChange={(miniPlace) => update({ miniPlace })}
              options={[
                { value: 'panel', label: tr('In the right panel') },
                { value: 'sidebar', label: tr('In the sidebar') },
                { value: 'float', label: tr('Floating') },
              ]}
            />
          </Row>
          <Row setting="progressStyle" label={msg('Progress bar')} sub={tr('The played part of the seek bar: a line, a wave that moves while the song plays, or the song’s own shape (your files; others show the wave)')} preview={<ProgressScene progressStyle={s.progressStyle} />}>
            <Segmented
              label={tr('Progress bar')}
              value={s.progressStyle}
              onChange={(progressStyle) => update({ progressStyle })}
              options={[
                { value: 'line', label: tr('Straight') },
                { value: 'wave', label: tr('Wavy') },
                { value: 'shape', label: tr('Song’s shape') },
              ]}
            />
          </Row>
          <Row setting="coverClock" label={msg('Clock on the cover display')} sub={tr('The cover display (Now Playing, beside Karaoke) shows the time and the day in a corner, for a second screen')}>
            <Toggle label={tr('Clock on the cover display')} checked={s.coverClock} onChange={(coverClock) => update({ coverClock })} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Immersive player')}>
        <div className="rounded-xl border border-line bg-raised">
          {/* A narrow pane puts the words under the picture: beside it, they went off the screen. */}
          <div className="flex items-center gap-5 border-b border-line-soft p-4 @max-lg:flex-col @max-lg:items-stretch @max-lg:gap-3">
            <NowPlayingScene s={{ ...s, immersive: true }} big />
            <p className="max-w-48 text-xs text-ink-2 @max-lg:max-w-none">
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
          <Row setting="backdropMotion" label={msg('Background motion')} sub={tr('The cover drifts slowly behind the player')}>
            <Toggle label={tr('Background motion')} checked={s.backdropMotion} onChange={(backdropMotion) => update({ backdropMotion })} />
          </Row>
        </div>
      </Group>
      {/* Folded away like the hi-fi's own extras; a search result inside opens it (SettingsView). */}
      <Group title={msg('Hi-Fi extras')}>
        <details className="group/hifi rounded-xl border border-line bg-raised">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-xs text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex-1">{tr('The source icon, the sleep timer’s moon, the volume knob and the tuner scale')}</span>
            <CaretDown size={14} className="shrink-0 transition-transform group-open/hifi:rotate-180" />
          </summary>
          <div className="border-t border-line-soft">
            <Row setting="readout" label={msg('Source icon')} sub={tr('Where the song plays from, in the player bar and Now Playing')} preview={<SourceIconScene readout={s.readout} />}>
              <Toggle label={tr('Source icon')} checked={s.readout} onChange={(readout) => update({ readout })} />
            </Row>
            <Row setting="sleepButton" label={msg('Sleep timer button')} sub={tr('Moon next to the volume (the timer stays in the player’s menu)')} preview={<SleepButtonScene sleepButton={s.sleepButton} />}>
              <Toggle label={tr('Sleep timer button')} checked={s.sleepButton} onChange={(sleepButton) => update({ sleepButton })} />
            </Row>
            <Row setting="volume" label={msg('Volume control')} sub={tr('An amplifier knob, or a speaker and a bar')} preview={<VolumeScene volume={s.volume} />}>
              <Segmented label={tr('Volume control')} value={s.volume} onChange={(volume) => update({ volume })} options={[{ value: 'knob', label: tr('Knob') }, { value: 'bar', label: tr('Bar') }]} />
            </Row>
            <Row setting="tuner" label={msg('Tuner scale')} sub={tr('Tuner-style progress bar in full screen')} preview={<TunerScene tuner={s.tuner} />}>
              <Toggle label={tr('Tuner scale')} checked={s.tuner} onChange={(tuner) => update({ tuner })} />
            </Row>
          </div>
        </details>
      </Group>
      <Group title={msg('Lists and navigation')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="listCovers" label={msg('Covers in lists')} preview={<ListCoversScene listCovers={s.listCovers} />}>
            <Toggle label={tr('Covers in lists')} checked={s.listCovers} onChange={(listCovers) => update({ listCovers })} />
          </Row>
          <Row setting="columnBrowser" label={msg('Column browser')} sub={tr('Artists and albums in two panes above Songs: pick one, the list shows its songs')} preview={<BrowserScene columnBrowser={s.columnBrowser} />}>
            <Toggle label={tr('Column browser')} checked={s.columnBrowser} onChange={(columnBrowser) => update({ columnBrowser })} />
          </Row>
          <Row setting="sidebarCounts" label={msg('Counts in the sidebar')} sub={tr('Number of songs next to each entry')} preview={<CountsScene sidebarCounts={s.sidebarCounts} />}>
            <Toggle label={tr('Counts in the sidebar')} checked={s.sidebarCounts} onChange={(sidebarCounts) => update({ sidebarCounts })} />
          </Row>
          <Row setting="motion" label={msg('Animations')} sub={tr('Pages, menus, Now Playing and covers move a little. Off: nothing moves')} preview={<MotionScene motion={s.motion} />}>
            <Toggle label={tr('Animations')} checked={s.motion} onChange={(motion) => update({ motion })} />
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
      <p className="text-[0.8125rem] text-ink-2">{tr('Blocks ads and trackers with Brave’s engine (adblock-rust) and the EasyList and EasyPrivacy lists, updated every 4 days. In the YouTube player, ad slots are removed before playback.')}</p>
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

/** Every host talked to today (music_core::netlog), refreshed while open. */
function PrivacySection() {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  useEffect(() => {
    const tick = () => api.netToday(-new Date().getTimezoneOffset() * 60).then(setContacts, () => setContacts([]))
    void tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [])
  const groups = byVia(contacts ?? [])
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <div className="flex flex-col items-start gap-3">
        <p className="text-[0.8125rem] text-ink-2">{tr('Every host Legato talked to today, and why: the app itself, its windows (YouTube’s player, sign-in pages) and plugins. Kept in memory on this PC only.')}</p>
        <Button variant="ghost" onClick={() => void openUrl(PRIVACY_PAGE).catch(() => {})}>
          <ArrowSquareOut size={14} /> {phoneApp ? tr('What leaves your phone') : tr('What leaves your PC')}
        </Button>
      </div>
      {contacts && !groups.length && <p className="text-[0.8125rem] text-ink-2">{tr('Nothing yet today.')}</p>}
      {groups.map((g) => (
        <Group key={g.via} title={VIA_LABELS[g.via]} count={g.rows.length}>
          <div className="divide-y divide-line rounded-xl border border-line bg-raised">
            {g.rows.map((c) => (
              <div key={c.host + c.why} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 text-[0.8125rem]">
                <span title={c.host} className="truncate font-mono">
                  {c.host}
                </span>
                <span className="text-right text-ink-2 tabular-nums">{countText(c)}</span>
                <span className="truncate text-ink-2">
                  {tr(WHY_LABELS[c.why])}
                  {c.blocked > 0 && ` · ${tr('Blocked: {n}', { n: formatCount(c.blocked) })}`}
                </span>
                <span className="text-right text-xs text-ink-3">{timeAgo(c.last)}</span>
              </div>
            ))}
          </div>
        </Group>
      ))}
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
  const used = s.adaptiveSound || s.coverPulse || s.visualizer
  return (
    <Group title={msg('Sound processing')}>
      <div className="rounded-xl border border-line bg-raised">
        <Row setting="adaptiveSound" label={msg('Adaptive Sound')} sub={tr('Loud and quiet songs end up alike, adjusted as they play. A thin line under the volume shows the result. Local files and YouTube; not Spotify (its own app plays it).')}>
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
        <Row setting="levelling" label={msg('Volume levelling')} sub={tr('Your own files play as loud as streamed songs: from their ReplayGain tags, or measured the first time they play. Album keeps an album’s quiet songs quiet, when its tags have an album gain')}>
          <Segmented
            label={tr('Volume levelling')}
            value={s.levelling}
            onChange={(levelling) => update({ levelling })}
            options={[
              { value: 'off', label: tr('Off') },
              { value: 'track', label: tr('Song') },
              { value: 'album', label: tr('Album') },
            ]}
          />
        </Row>
        <Row setting="coverPulse" label={msg('Moving cover')} sub={s.motion ? tr('In Now Playing, the cover swells and settles with the music') : tr('Needs Animations on (Appearance)')}>
          <Toggle label={tr('Moving cover')} checked={s.coverPulse} onChange={(coverPulse) => update({ coverPulse })} />
        </Row>
        <Row setting="visualizer" label={msg('Visualizer')} sub={s.motion ? tr('In Now Playing, bars under the cover move with the music, low notes on the left') : tr('Needs Animations on (Appearance)')}>
          <Toggle label={tr('Visualizer')} checked={s.visualizer} onChange={(visualizer) => update({ visualizer })} />
        </Row>
        {s.visualizer && (
          <Row setting="visualizerStyle" label={msg('Visualizer style')} sub={tr('Radial goes around a big cover; where the cover is small it shows bars. VU needles follow the average level, PPM needles the peaks')}>
            <LookChoice />
          </Row>
        )}
        {s.visualizer && needleLook(s.visualizerStyle) && (
          <Row setting="visualizerFace" label={msg('Meter face')} sub={tr('The needles’ dial: in the theme’s colors, or a warm backlit face like an old hi-fi')}>
            <Segmented label={tr('Meter face')} value={s.visualizerFace} onChange={(visualizerFace) => update({ visualizerFace })} options={VIZ_FACES.map((v) => ({ value: v, label: tr(VIZ_FACE_LABELS[v]) }))} />
          </Row>
        )}
        {s.visualizer && s.visualizerStyle === 'spectrogram' && (
          <Row setting="visualizerColormap" label={msg('Spectrogram colors')} sub={tr('In the theme’s colors, or a color map as in sound tools: dark when quiet, bright when loud')}>
            <Segmented label={tr('Spectrogram colors')} value={s.visualizerColormap} onChange={(visualizerColormap) => update({ visualizerColormap })} options={VIZ_COLORMAPS.map((v) => ({ value: v, label: tr(VIZ_COLORMAP_LABELS[v]) }))} />
          </Row>
        )}
        {s.visualizer && s.visualizerStyle === 'preset' && (
          <Row setting="visualizerPreset" label={msg('Visualizer preset')} sub={tr('Pictures that zoom, turn and flow with the music, MilkDrop’s way. Add your own from .milk or .json files')}>
            <PresetChoice />
          </Row>
        )}
        {s.visualizer && s.visualizerStyle === 'preset' && (
          <Row setting="visualizerPresetColors" label={msg('Preset colors')} sub={tr('In the theme’s colors, the picture’s light as its strength; or in the preset’s own')}>
            <Segmented label={tr('Preset colors')} value={s.visualizerPresetColors} onChange={(visualizerPresetColors) => update({ visualizerPresetColors })} options={VIZ_PRESET_COLORS.map((v) => ({ value: v, label: tr(VIZ_PRESET_COLOR_LABELS[v]) }))} />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerWeighting" label={msg('Visualizer weighting')} sub={tr('Lows against highs: as measured, the highs lifted 3 dB per octave, or as the ear hears them')}>
            <Segmented
              label={tr('Visualizer weighting')}
              className="max-w-md flex-wrap rounded-3xl!"
              value={s.visualizerWeighting}
              onChange={(visualizerWeighting) => update({ visualizerWeighting })}
              options={VIZ_WEIGHTINGS.map((v) => ({ value: v, label: tr(VIZ_WEIGHTING_LABELS[v]) }))}
            />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerColor" label={msg('Visualizer color')} sub={tr("The theme's text color, its accent, or the cover's color made bright enough to read")}>
            <Segmented
              label={tr('Visualizer color')}
              className="max-w-md flex-wrap rounded-3xl!"
              value={s.visualizerColor}
              onChange={(visualizerColor) => update({ visualizerColor })}
              options={VIZ_COLORS.map((v) => ({ value: v, label: tr(VIZ_COLOR_LABELS[v]) }))}
            />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerGradient" label={msg('Visualizer gradient')} sub={tr('Over its color: warming to red near the top like a level meter, or a prism from red lows to violet highs')}>
            <Segmented
              label={tr('Visualizer gradient')}
              className="max-w-md flex-wrap rounded-3xl!"
              value={s.visualizerGradient}
              onChange={(visualizerGradient) => update({ visualizerGradient })}
              options={VIZ_GRADIENTS.map((v) => ({ value: v, label: tr(VIZ_GRADIENT_LABELS[v]) }))}
            />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerBands" label={msg('Visualizer bands')} sub={tr('1/6 octave as measured, 1/3 octave: fewer, wider bars, like a hi-fi analyzer, or 1/12 octave: twice the detail, for a wide visualizer. Point at a big visualizer for its Hz and dB scales')}>
            <Segmented
              label={tr('Visualizer bands')}
              className="max-w-md flex-wrap rounded-3xl!"
              value={s.visualizerBands}
              onChange={(visualizerBands) => update({ visualizerBands })}
              options={VIZ_BANDINGS.map((v) => ({ value: v, label: tr(VIZ_BANDING_LABELS[v]) }))}
            />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerFloor" label={msg('Visualizer reflection')} sub={tr('The bars stand on a glossy floor that reflects them')}>
            <Toggle label={tr('Visualizer reflection')} checked={s.visualizerFloor} onChange={(visualizerFloor) => update({ visualizerFloor })} />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerBackdrop" label={msg('Visualizer behind Now Playing')} sub={tr('Big and faint across the bottom of Now Playing, behind the song')}>
            <Toggle label={tr('Visualizer behind Now Playing')} checked={s.visualizerBackdrop} onChange={(visualizerBackdrop) => update({ visualizerBackdrop })} />
          </Row>
        )}
        {s.visualizer && (
          <Row setting="visualizerMini" label={msg('Visualizer in the mini player')} sub={tr('A thin strip of it under the song in the mini player, wherever it sits')}>
            <Toggle label={tr('Visualizer in the mini player')} checked={s.visualizerMini} onChange={(visualizerMini) => update({ visualizerMini })} />
          </Row>
        )}
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


/** Cover cache: its size cap on this PC, what it holds now, and a way to empty it. */
function CoverCacheRows() {
  const { settings: s, update } = useSettings()
  const [used, setUsed] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const count = () => void api.artCacheSize().then(setUsed, () => setUsed(null))
  useEffect(count, [])
  const clear = async () => {
    setBusy(true)
    await api.clearArtCache().catch(() => 0)
    setBusy(false)
    count()
  }
  const label = (mb: number) => (mb >= 1000 ? tr('{n} GB', { n: mb / 1000 }) : tr('{n} MB', { n: mb }))
  return (
    <div className="rounded-xl border border-line bg-raised">
      <Row setting="coverCacheMb" label={msg('Cover cache size')} sub={(phoneApp ? tr('Covers kept on this phone to show them quickly. Over the limit, the ones not shown for the longest time go first and download again when needed') : tr('Covers kept on this PC to show them quickly. Over the limit, the ones not shown for the longest time go first and download again when needed'))}>
        <Segmented label={tr('Cover cache size')} value={String(s.coverCacheMb)} onChange={(mb) => update({ coverCacheMb: Number(mb) as Settings['coverCacheMb'] })} options={COVER_CACHE_MB.map((mb) => ({ value: String(mb), label: label(mb) }))} />
      </Row>
      <Row label={msg('Clear covers')} sub={used === null ? undefined : (phoneApp ? tr('{size} on this phone now. Playlist pictures and theme backgrounds stay', { size: formatBytes(used) }) : tr('{size} on this PC now. Playlist pictures and theme backgrounds stay', { size: formatBytes(used) }))}>
        <Button variant="ghost" disabled={busy || used === 0} onClick={() => void clear()}>
          {tr('Clear covers')}
        </Button>
      </Row>
    </div>
  )
}
/** The whole library in one file, and back: the app restarts on a restored one. */
function BackupRows() {
  const [busy, setBusy] = useState(false)
  const filters = [{ name: tr('Legato library backup'), extensions: ['legato'] }]
  const backUp = async () => {
    try {
      const name = await saveFile({ title: tr('Back up your library'), defaultPath: `Legato ${new Date().toISOString().slice(0, 10)}.legato`, filters }, (path) => (setBusy(true), api.libraryBackup(path)))
      if (name) useStore.getState().notify(tr('Library saved: {file}', { file: name }))
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  const restore = async () => {
    // A daily or pre-update copy (library-*.db) restores too.
    const path = await pickFile({ title: tr('Restore a backup'), filters: [{ ...filters[0], extensions: ['legato', 'db'] }] }).catch((e) => void useStore.setState({ error: String(e) }))
    if (!path) return
    if (!(await ask({ title: tr('Replace your library with this backup?'), body: tr('Your playlists, likes, history and settings become the backup’s, then Legato restarts.'), ok: tr('Restore') }))) return
    setBusy(true)
    try {
      await api.libraryRestore(path)
    } catch (e) {
      useStore.setState({ error: String(e) })
      setBusy(false)
    }
  }
  return (
    <div className="rounded-xl border border-line bg-raised">
      <Row label={msg('Back up your library')} sub={(phoneApp ? tr('Playlists, likes, history, Live Editor versions and settings in one file, for another device or for later. Sign-ins stay out.') : tr('Playlists, likes, history, Live Editor versions and settings in one file, for another PC or for later. Sign-ins stay out.'))}>
        <Button variant="ghost" disabled={busy} onClick={() => void backUp()}>
          {tr('Back up…')}
        </Button>
      </Row>
      <Row label={msg('Library health')} sub={tr('Songs that can’t play, files gone, songs with no cover or missing their artist or album: one page to fix them.')}>
        <Button variant="ghost" onClick={() => useStore.getState().go({ name: 'health' })}>
          {tr('Open')}
        </Button>
      </Row>
      <Row label={msg('Restore a backup')} sub={tr('Replaces this library with the file’s, then Legato restarts. The library you have now is kept beside it first.')}>
        <Button variant="ghost" disabled={busy} onClick={() => void restore()}>
          {tr('Restore…')}
        </Button>
      </Row>
    </div>
  )
}

function GeneralSection() {
  const { settings: s, update } = useSettings()
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <Group title={msg('Language')}>
        <LanguagePicker value={s.language} onChange={(language) => update({ language })} />
      </Group>
      <Group title={msg('Starting and closing')}>
        <div className="rounded-xl border border-line bg-raised">
          <OpenAtStartup />
          <Row setting="closeToTray" label={msg('Keep running in the notification area')} sub={s.closeToTray ? tr('Closing the window keeps the music going; Quit from the icon’s menu') : tr('Closing the window quits the app')}>
            <Toggle label={tr('Keep running in the notification area')} checked={s.closeToTray} onChange={(closeToTray) => update({ closeToTray })} />
          </Row>
          <Row setting="reopen" label={msg('Reopen where you left off')} sub={tr('Same screen as when the app closed, Now Playing open if it was')}>
            <Toggle label={tr('Reopen where you left off')} checked={s.reopen} onChange={(reopen) => update({ reopen })} />
          </Row>
          <Row setting="resume" label={msg('Resume playback on launch')} sub={tr('The last song picks up where it stopped, with its queue, when the app opens')}>
            <Toggle label={tr('Resume playback on launch')} checked={s.resume} onChange={(resume) => update({ resume })} />
          </Row>
          <Row label={msg('Open on')} sub={s.reopen ? tr('Used when “Reopen where you left off” is off (above)') : tr('Screen shown when the app starts')}>
            <Segmented label={tr('Open on')} value={s.startView} onChange={(startView) => update({ startView })} options={[{ value: 'home', label: tr('Home') }, { value: 'songs', label: tr('Songs') }, { value: 'mixes', label: tr('Mixes') }, { value: 'albums', label: tr('Albums') }, { value: 'artists', label: tr('Artists') }]} />
          </Row>
        </div>
      </Group>
      {/* The phone's app doesn't update itself (its row is desktop only): no empty group. */}
      {!phoneApp && (
        <Group title={msg('Updates')}>
          <div className="rounded-xl border border-line bg-raised">
            <Row setting="updateChannel" label={msg('Update channel')} sub={s.updateChannel === 'beta' ? tr('Every change first, so it may break. Back on Stable, the app waits for a Stable version newer than this one: it never goes back to an older one') : tr('Versions already tried on Beta. Pick Beta to get every change first')}>
              <Segmented label={tr('Update channel')} value={s.updateChannel} onChange={(updateChannel) => update({ updateChannel })} options={[{ value: 'stable', label: tr('Stable') }, { value: 'beta', label: tr('Beta') }]} />
            </Row>
          </div>
        </Group>
      )}
      <Group title={msg('Cover cache')}>
        <CoverCacheRows />
      </Group>
      <Group title={msg('Library backup')}>
        <BackupRows />
      </Group>
      <Group title={msg('Notifications')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="toastPlace" label={msg('Notification position')} sub={tr('Where the short messages show (song added, liked, errors…)')}>
            <Segmented label={tr('Notification position')} value={s.toastPlace} onChange={(toastPlace) => update({ toastPlace })} options={[{ value: 'bottom', label: tr('Bottom') }, { value: 'bottomRight', label: tr('Bottom right') }, { value: 'top', label: tr('Top') }, { value: 'topRight', label: tr('Top right') }]} />
          </Row>
          <Row setting="toastShow" label={msg('Which notifications')} sub={tr('Important: errors, and the ones with a button (Undo, Open…)')}>
            <Segmented label={tr('Which notifications')} value={s.toastShow} onChange={(toastShow) => update({ toastShow })} options={[{ value: 'all', label: tr('All') }, { value: 'important', label: tr('Important only') }]} />
          </Row>
          <Row setting="toastTime" label={msg('How long notifications stay')} sub={tr('Errors stay twice as long')}>
            <Segmented label={tr('How long notifications stay')} value={s.toastTime} onChange={(toastTime) => update({ toastTime })} options={[{ value: 'short', label: tr('Short') }, { value: 'normal', label: tr('Normal') }, { value: 'long', label: tr('Long') }]} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Search bar')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="rememberSearches" label={msg('Remember recent searches')} sub={(phoneApp ? tr('Listed when you click the search bar. Kept on this phone only, never synced') : tr('Listed when you click the search bar. Kept on this PC only, never synced'))}>
            <Toggle label={tr('Remember recent searches')} checked={s.rememberSearches} onChange={(rememberSearches) => (update({ rememberSearches }), rememberSearches || clearRecent())} />
          </Row>
          <Row setting="searchSuggestions" label={msg('Search suggestions')} sub={tr('YouTube’s suggestions as you type: what you type goes to Google')}>
            <Toggle label={tr('Search suggestions')} checked={s.searchSuggestions} onChange={(searchSuggestions) => update({ searchSuggestions })} />
          </Row>
          <Row setting="searchOnCover" label={msg('Over the cover in Now Playing')} sub={tr('Centered above the cover or video, not the window, when a panel is open beside it')}>
            <Toggle label={tr('Over the cover in Now Playing')} checked={s.searchOnCover} onChange={(searchOnCover) => update({ searchOnCover })} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Voice and recognition')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="voiceSearch" label={msg('Voice search')} sub={tr('The mic in the search bar. Windows’ online speech recognition: your voice goes to Microsoft’s service while the mic listens, nothing is kept')}>
            <Toggle label={tr('Voice search')} checked={s.voiceSearch} onChange={(voiceSearch) => update({ voiceSearch })} />
          </Row>
          <Row setting="detector" label={msg('Music Detector')} sub={tr('Identify a song (Add music, or the mic): 10 seconds from the microphone or from what this PC plays, kept in memory, sent once to AudD with your token, nothing saved')}>
            <Toggle label={tr('Music Detector')} checked={s.detector} onChange={(detector) => update({ detector })} />
          </Row>
        </div>
      </Group>
    </div>
  )
}

const freshLabels: Record<number, string> = { 0: msg('No wait'), 1: msg('A day'), 7: msg('A week'), 30: msg('A month') }
const gapLabels: Record<number, string> = { 0: msg('Any time'), 3: msg('After 3 songs'), 10: msg('After 10 songs') }

/** Monday first; 0 = Sunday, as Date.getDay(). */
const WEEK = [1, 2, 3, 4, 5, 6, 0]

function AlarmGroup() {
  const { settings: s, update } = useSettings()
  const playlists = useStore((st) => st.playlists)
  const a = s.alarm
  const set = (p: Partial<Alarm>) => update({ alarm: { ...a, ...p } })
  // 1 November 2026 was a Sunday: + d is that weekday.
  const day = (d: number, weekday: 'short' | 'long') => new Intl.DateTimeFormat(locale(), { weekday }).format(new Date(2026, 10, 1 + d))
  const next = nextAlarm(Date.now(), a)
  const when = next === null ? undefined : new Intl.DateTimeFormat(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(next)
  const field = 'rounded-md border border-line bg-bg px-2 py-1.5 text-[0.8125rem]'
  return (
    <Group title={msg('Alarm')} hint={when && tr('Next: {when}', { when })}>
      <div className="rounded-xl border border-line bg-raised">
        <Row setting="alarm" label={msg('Alarm')} sub={tr('Wakes you up with music. Legato must be running: closed to the notification area is fine, but a PC asleep doesn’t wake for it')}>
          <Toggle label={tr('Alarm')} checked={a.on} onChange={(on) => set({ on })} />
        </Row>
        {a.on && (
          <>
            <Row label={msg('Alarm time')}>
              <input type="time" aria-label={tr('Alarm time')} value={a.time} onChange={(e) => e.target.value && set({ time: e.target.value })} className={field} />
            </Row>
            <Row label={msg('Alarm days')} sub={a.days.length ? undefined : tr('No day picked: it won’t ring')}>
              <div role="group" aria-label={tr('Alarm days')} className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-full border border-line p-[3px]">
                {WEEK.map((d) => {
                  const on = a.days.includes(d)
                  return (
                    <button key={d} type="button" aria-pressed={on} title={day(d, 'long')} onClick={() => set({ days: on ? a.days.filter((x) => x !== d) : [...a.days, d].sort((x, y) => x - y) })} className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink'}`}>
                      {day(d, 'short')}
                    </button>
                  )
                })}
              </div>
            </Row>
            <Row label={msg('Alarm music')} sub={tr('A playlist from its first song, or all your songs shuffled')}>
              <select aria-label={tr('Alarm music')} value={a.playlist ?? ''} onChange={(e) => set({ playlist: e.target.value ? Number(e.target.value) : null })} className={`${field} max-w-56`}>
                <option value="">{tr('All your songs, shuffled')}</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={msg('Alarm fade-in')} sub={a.fadeMin ? tr('From silence to your volume over {n} min', { n: a.fadeMin }) : tr('Off: at your volume at once')}>
              <input type="range" aria-label={tr('Alarm fade-in')} min={0} max={15} step={1} value={a.fadeMin} onChange={(e) => set({ fadeMin: +e.target.value })} className="bar w-40" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${(a.fadeMin / 15) * 100}%, var(--line) 0)` }} />
            </Row>
          </>
        )}
      </div>
    </Group>
  )
}

function PlaybackSection() {
  const { settings: s, update } = useSettings()
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <Group title={msg('Fades')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Fade between songs')} preview={!s.fade.advanced && <FadeScene crossfade={s.crossfade} />} sub={s.fade.advanced ? tr('Advanced: {out} s out ({outCurve}), {in} s in ({inCurve})', { out: s.fade.out, outCurve: tr(curveLabels[s.fade.outCurve]), in: s.fade.in, inCurve: tr(curveLabels[s.fade.inCurve]) }) : s.crossfade ? tr('{n} s fade out, then in, when a song ends on its own', { n: s.crossfade }) : tr('No fade')}>
            {!s.fade.advanced && (
              <input type="range" aria-label={tr('Fade between songs')} min={0} max={12} step={1} value={s.crossfade} onChange={(e) => update({ crossfade: +e.target.value })} className="bar w-40" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${(s.crossfade / 12) * 100}%, var(--line) 0)` }} />
            )}
          </Row>
          <Row label={msg('Advanced fade')} sub={s.fade.advanced ? tr('Your own lengths and shapes, below') : tr('Off: {fade}', { fade: s.crossfade ? tr('{n} s each way, S-curve', { n: s.crossfade }) : tr('no fade') })}>
            <Toggle label={tr('Advanced fade')} checked={s.fade.advanced} onChange={(advanced) => update({ fade: { ...s.fade, advanced } })} />
          </Row>
          <Row setting="gaplessAlbums" label={msg('No fade within an album')} sub={tr('Songs of one album that follow each other play on without a fade: a live or continuous album never dips')}>
            <Toggle label={tr('No fade within an album')} checked={s.gaplessAlbums} onChange={(gaplessAlbums) => update({ gaplessAlbums })} />
          </Row>
          <Row setting="earlyEnds" label={msg('Early endings')} sub={tr('YouTube videos whose song ends early (silence, an end screen): the fade and the next song start where the song ends. Learned as they play')}>
            <Toggle label={tr('Early endings')} checked={s.earlyEnds} onChange={(earlyEnds) => update({ earlyEnds })} />
          </Row>
          <Row setting="skipSilence" label={msg('Skip silence')} sub={tr('Songs start on the music and end where it ends, when they open or close with more than a moment of silence. Off by default: some silences are meant (hidden tracks, gapless albums)')}>
            <Toggle label={tr('Skip silence')} checked={s.skipSilence} onChange={(skipSilence) => update({ skipSilence })} />
          </Row>
          <Row setting="skipNonMusic" label={msg('Skip non-music parts')} sub={tr('Intros, skits and talking in music videos are skipped, from SponsorBlock’s community marks. For each YouTube video, 4 characters of its id’s hash go to sponsor.ajay.app, never the id. Off by default')}>
            <Toggle label={tr('Skip non-music parts')} checked={s.skipNonMusic} onChange={(skipNonMusic) => update({ skipNonMusic })} />
          </Row>
        </div>
        {s.fade.advanced && <FadeEditor />}
      </Group>
      <Group title={msg('Clicks')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row label={msg('Play with')} sub={tr('On a track row')}>
            <Segmented label={tr('Play with')} value={s.clickToPlay} onChange={(clickToPlay) => update({ clickToPlay })} options={[{ value: 'single', label: tr('One click') }, { value: 'double', label: tr('Double-click') }]} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Up next')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="smartShuffle" label={msg('Smart shuffle')} sub={tr('Shuffle spreads each artist through the queue and plays the songs you heard in the last day after the others')}>
            <Toggle label={tr('Smart shuffle')} checked={s.smartShuffle} onChange={(smartShuffle) => update({ smartShuffle })} />
          </Row>
          <Row setting="skipLong" label={msg('Skip long songs')} sub={s.skipLong ? tr('Songs over {n} min are skipped as the queue moves on', { n: s.skipLong }) : tr('Off')}>
            <input type="range" aria-label={tr('Skip long songs')} min={0} max={60} step={1} value={s.skipLong} onChange={(e) => update({ skipLong: +e.target.value })} className="bar w-40" style={{ backgroundImage: `linear-gradient(to right, var(--ink) ${(s.skipLong / 60) * 100}%, var(--line) 0)` }} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Auto-DJ')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="djFresh" label={msg('Songs heard lately')} sub={tr('A song heard within this time waits until the others have played')}>
            <Segmented label={tr('Songs heard lately')} value={String(s.djFresh)} onChange={(v) => update({ djFresh: +v })} options={DJ_FRESH.map((d) => ({ value: String(d), label: tr(freshLabels[d]) }))} />
          </Row>
          <Row setting="djRated" label={msg('Your ratings count')} sub={tr('Five stars come up four times as often as an unrated song, one star a quarter as often; artists in your Liked Music, twice as often')}>
            <Toggle label={tr('Your ratings count')} checked={s.djRated} onChange={(djRated) => update({ djRated })} />
          </Row>
          <Row setting="djGap" label={msg('Same artist again')} sub={tr('An artist waits this many songs before playing again, unless no one else is left')}>
            <Segmented label={tr('Same artist again')} value={String(s.djGap)} onChange={(v) => update({ djGap: +v })} options={DJ_GAPS.map((n) => ({ value: String(n), label: tr(gapLabels[n]) }))} />
          </Row>
        </div>
      </Group>
      <AlarmGroup />
      <Group title={msg('Headphones and calls')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="pauseOnUnplug" label={msg('Pause when headphones disconnect')} sub={tr('Headphones unplugged, a Bluetooth headset or speaker turned off: the music pauses instead of going on through the speakers')}>
            <Toggle label={tr('Pause when headphones disconnect')} checked={s.pauseOnUnplug} onChange={(pauseOnUnplug) => update({ pauseOnUnplug })} />
          </Row>
          <Row setting="pauseOnCall" label={msg('Pause during calls')} sub={tr('A Teams or Skype call starts: the music pauses, and plays on when the call ends. Off: Windows lowers it, as set in its sound settings')}>
            <Toggle label={tr('Pause during calls')} checked={s.pauseOnCall} onChange={(pauseOnCall) => update({ pauseOnCall })} />
          </Row>
        </div>
      </Group>
      <Group title={msg('Phone remote')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="phoneRemote" label={msg('Phone remote')} sub={tr('Play, pause, skip and see what’s next from a phone on the same network. The page comes from this PC: nothing goes through the internet. Off by default')}>
            <Toggle label={tr('Phone remote')} checked={s.phoneRemote} onChange={(phoneRemote) => update({ phoneRemote })} />
          </Row>
          {s.phoneRemote && <RemotePanel />}
        </div>
      </Group>
      <Group title={msg('Streaming overlay')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="streamOverlay" label={msg('Streaming overlay')} sub={tr('The song playing, its cover and progress on a page for OBS or another streaming app on this PC. This PC only. Off by default')}>
            <Toggle label={tr('Streaming overlay')} checked={s.streamOverlay} onChange={(streamOverlay) => update({ streamOverlay })} />
          </Row>
          {s.streamOverlay && (
            <Row setting="visualizerOverlay" label={msg('Visualizer on the overlay')} sub={tr('Bars under the song that move with the music, measured only while OBS shows the page')}>
              <Toggle label={tr('Visualizer on the overlay')} checked={s.visualizerOverlay} onChange={(visualizerOverlay) => update({ visualizerOverlay })} />
            </Row>
          )}
          {s.streamOverlay && <OverlayPanel />}
        </div>
      </Group>
      <SoundGroup />
      <Group title={msg('YouTube videos')}>
        <div className="rounded-xl border border-line bg-raised">
          <Row setting="subtitles" label={msg('Subtitles on videos')} sub={tr('Off: hidden even when your Google account shows them')}>
            <Toggle label={tr('Subtitles on videos')} checked={s.subtitles} onChange={(subtitles) => update({ subtitles })} />
          </Row>
          <Row setting="youtubeControls" label={msg('YouTube controls on the video')} sub={tr("YouTube's own title, buttons and hover menu on the video. From the next track.")}>
            <Toggle label={tr('YouTube controls on the video')} checked={s.youtubeControls} onChange={(youtubeControls) => update({ youtubeControls })} />
          </Row>
        </div>
      </Group>
    </div>
  )
}

/** Search box over the section list: results replace it while typing, Enter opens the first. */
function SettingsSearch({ onPick }: { onPick: (e: SettingEntry) => void }) {
  const [q, setQ] = useState('')
  const hits = searchSettings(q).filter((e) => !phoneApp || !(DESKTOP_ONLY.has(e.label) || DESKTOP_ONLY_SECTIONS.has(e.section))).slice(0, 12)
  const pick = (e: SettingEntry) => {
    setQ('')
    onPick(e)
  }
  return (
    <>
      <label className="mb-2 flex w-full items-center gap-2 rounded-full border border-line px-3 py-1.5 text-ink-3 focus-within:border-ink-3">
        <MagnifyingGlass size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' && hits[0] ? pick(hits[0]) : e.key === 'Escape' && setQ(''))} placeholder={tr('Search settings')} aria-label={tr('Search settings')} className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink outline-none placeholder:text-ink-3" />
      </label>
      {q.trim() && (
        <div className="flex flex-col gap-px">
          {hits.length === 0 && <p className="px-2 py-2 text-xs text-ink-3">{tr('No setting matches.')}</p>}
          {hits.map((e) => (
            <button key={`${e.section}/${e.label}`} onClick={() => pick(e)} className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-raised">
              <span className="text-[0.8125rem]">{tr(e.label)}</span>
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
  // Set up once, signed out since (expired session): Accounts says so.
  const signIn = useStore((s) => Object.values(s.status).some((x) => x.configured && !x.connected))
  // Search result opened: bring the setting into view and flash it.
  useEffect(() => {
    if (!focus) return
    const el = [...(content.current?.querySelectorAll<HTMLElement>('[data-setting]') ?? [])].find((x) => x.dataset.setting === focus)
    if (!el) return
    // Folded group (Hi-Fi extras): opened first, a closed one has nothing to show.
    const fold = el.closest('details')
    if (fold) fold.open = true
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  }, [focus, section])
  return (
    <>
      <PageHeader kicker={tr('Settings')} title={tr(sections.find((s) => s.id === section)!.label)} />
      {/* Narrow (small window, or the connect wizard beside it): sections in rows above the page, not a squeezed column.
          The container is a wrapper: an element can't query its own width. */}
      <div className="@container flex min-h-0 flex-1 flex-col">
      {/* The phone scrolls the sections' row with the page: fixed, it took half the screen. The page's bleed (room for
          focus rings) moves here: on the content it overflowed sideways, and the row shifted under the left edge. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 @2xl:flex-row @2xl:gap-9 phone:-mx-2 phone:overflow-y-auto phone:px-2">
        <nav className="flex shrink-0 flex-wrap gap-px @2xl:w-52 @2xl:flex-col @2xl:flex-nowrap">
          <SettingsSearch onPick={(e) => go({ name: 'settings', section: e.section, focus: e.label })} />
          {sections.filter((s) => !phoneApp || !DESKTOP_ONLY_SECTIONS.has(s.id)).map((s) => (
            <button key={s.id} aria-current={s.id === section ? 'page' : undefined} onClick={() => go({ name: 'settings', section: s.id })} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left ${s.id === section ? 'bg-raised font-semibold' : 'text-ink-2 hover:text-ink'}`}>
              {s.icon} <span className="flex-1">{tr(s.label)}</span>
              {s.id === 'sources' && signIn && <span title={tr('A service needs you to sign in again')} className="size-2 rounded-full bg-danger" />}
            </button>
          ))}
        </nav>
        {/* Its own width decides the rows' layout (@max-lg): the phone, a small window or the sections' column beside it. */}
        <div ref={content} className="@container -mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-8 phone:mx-0 phone:flex-none phone:overflow-visible phone:px-0">
          {section === 'general' && <GeneralSection />}
          {section === 'playback' && <PlaybackSection />}
          {section === 'appearance' && <Appearance />}
          {section === 'sources' && <SourcesView />}
          {section === 'sync' && <SyncSection />}
          {section === 'shield' && <ShieldSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
      </div>
    </>
  )
}

/** The visualizer's look: the built-in ones, then those running plugins offer. */
function LookChoice() {
  const style = useSettings((s) => s.settings.visualizerStyle)
  const plugin = useSettings((s) => s.settings.visualizerPlugin)
  const update = useSettings((s) => s.update)
  const looks = usePluginViz((s) => s.looks)
  return <Segmented label={tr('Visualizer style')} className="max-w-md flex-wrap rounded-3xl!" value={lookValue(style, plugin)} onChange={(v) => update(lookSettings(v))} options={lookOptions(looks)} />
}

/** The Presets look's preset: the built-in ones, then the imported ones; import, export, remove. */
function PresetChoice() {
  const id = useSettings((s) => s.settings.visualizerPreset)
  const saved = useSettings((s) => s.settings.visualizerPresets)
  const update = useSettings((s) => s.update)
  const own = saved.some((p) => p.id === id)
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <Segmented label={tr('Visualizer preset')} className="flex-wrap rounded-3xl!" value={id} onChange={(visualizerPreset) => update({ visualizerPreset })} options={presetOptions(saved)} />
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => void importPreset()}>
          {tr('Import')}
        </Button>
        <Button variant="ghost" onClick={() => void exportPreset()}>
          {tr('Export')}
        </Button>
        {own && (
          <Button variant="ghost" onClick={() => removePreset(id)}>
            {tr('Remove')}
          </Button>
        )}
      </div>
    </div>
  )
}

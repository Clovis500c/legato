import { ArrowSquareOut, Desktop, Microphone, Waveform } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type DetectMiss, type Track } from '../../shared/api'
import { region } from '../../shared/format'
import { Button } from '../../shared/ui/Button'
import { Segmented } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { usePlayer } from '../player/store'
import { msg, tr } from '../../shared/i18n/i18n'

const DASHBOARD = 'https://dashboard.audd.io/'
const SECONDS = 10

const MISSES: Record<DetectMiss, string> = {
  noToken: msg('Add your AudD token first.'),
  noMic: msg('No microphone found.'),
  micBlocked: msg('Windows keeps desktop apps away from the microphone. Allow them in Windows settings › Privacy & security › Microphone.'),
  micBusy: msg('Another app is using the microphone.'),
  noOutput: msg('No speakers or headphones found to listen to.'),
  silent: msg('The microphone heard almost nothing. Is it muted? Turn the music up or move closer.'),
  unclear: msg('The song couldn’t be made out: too quiet, too noisy or someone talking over it. Try again with the music louder.'),
  canceled: '',
  badToken: msg('AudD refused your token. Check it on dashboard.audd.io.'),
  limit: msg('Your AudD token has no requests left: see your plan on dashboard.audd.io.'),
  offline: msg('AudD can’t be reached. Check your internet connection.'),
  failed: msg('Recognition didn’t work this time.'),
}

type Input = 'mic' | 'pc'
type Phase = { name: 'idle' } | { name: 'consent'; input: Input } | { name: 'listening'; seconds: number; level: number } | { name: 'note'; text: string; mic?: boolean }

/** Asked once per source: what is heard, where it goes. */
const allowed = (input: Input) => (input === 'mic' ? useSettings.getState().settings.detector : useSettings.getState().settings.detectorPc)

/** AudD token: pasted once, kept in Windows' credential manager, never shown again. */
function TokenForm({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.setDetectorToken(token)
          onSaved()
        } catch (err) {
          setError(String(err))
        }
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-xs text-ink-2">
        {tr('Uses AudD (audd.io) with your own API token: free to try, then AudD’s own plans. Music App has no AudD account and no server.')}{' '}
        <button type="button" onClick={() => void openUrl(DASHBOARD)} className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline">
          {tr('Get a token')} <ArrowSquareOut size={11} />
        </button>
      </p>
      <span className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={tr('AudD API token')}
          aria-label={tr('AudD API token')}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 font-mono text-[11px] placeholder:text-ink-3"
        />
        <Button type="submit" disabled={!token.trim()} className="h-8 py-0!">
          {tr('Save')}
        </Button>
      </span>
      {error && <p className="text-xs text-danger">{error}</p>}
      {onCancel && (
        <button type="button" onClick={onCancel} className="self-start text-xs text-ink-2 hover:text-ink">
          {tr('Keep the current token')}
        </button>
      )}
    </form>
  )
}

/**
 * Music Detector (Add music): names a song, like Shazam. 10 s through the microphone (music around you) or from what
 * this PC plays (another app, a video), kept in memory and sent once to AudD (src-tauri detect_song). Each source is
 * asked once before its first use; Music App's own playback pauses meanwhile (it would be what's heard).
 */
export function Detector({ onFound }: { onFound: (t: Track) => void }) {
  const [token, setToken] = useState<boolean | null>(null)
  const [editing, setEditing] = useState(false)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const busy = useRef(false)

  useEffect(() => {
    void api
      .detectorStatus()
      .then(setToken)
      .catch(() => setToken(false))
  }, [])

  const input = useSettings((s) => s.settings.detectorInput)
  const listen = async () => {
    if (busy.current) return
    const from = useSettings.getState().settings.detectorInput
    if (!allowed(from)) return setPhase({ name: 'consent', input: from })
    busy.current = true
    // Our own music would be what it hears.
    const resume = usePlayer.getState().playing
    if (resume) usePlayer.getState().toggle()
    setPhase({ name: 'listening', seconds: 0, level: 0 })
    const off = await api.onDetect((seconds, level) => setPhase((p) => (p.name === 'listening' ? { name: 'listening', seconds, level } : p)))
    try {
      const r = await api.detectSong(region(), from)
      if (r.kind === 'found') {
        setPhase({ name: 'idle' })
        onFound(r.track)
      } else if (r.kind === 'unknown') setPhase({ name: 'note', text: from === 'mic' ? tr('No match. Try again closer to the music.') : tr('No match. Try again on another part of the song.') })
      else if (r.miss === 'canceled') setPhase({ name: 'idle' })
      else {
        if (r.miss === 'noToken') setToken(false)
        if (r.miss === 'badToken') setEditing(true)
        const text = r.miss === 'silent' && from === 'pc' ? tr('Nothing is playing on this PC (Music App pauses its own music while it listens).') : tr(MISSES[r.miss])
        setPhase({ name: 'note', text: text + (r.detail ? ` (${r.detail})` : ''), mic: r.miss === 'micBlocked' })
      }
    } catch (e) {
      setPhase({ name: 'note', text: `${tr(MISSES.failed)} (${String(e)})` })
    } finally {
      off()
      busy.current = false
      if (resume && !usePlayer.getState().playing) usePlayer.getState().toggle()
    }
  }

  // "Identify a song" from the mic menu.
  const asked = useStore((s) => s.identify)
  const seen = useRef(asked)
  useEffect(() => {
    if (asked === seen.current || token === null) return
    seen.current = asked
    if (token) void listen()
  }, [asked, token]) // once per ask

  const listening = phase.name === 'listening' ? phase : null
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold">
        <Waveform size={16} className="text-ink-2" /> {tr('Identify a song')}
      </p>
      {token === false || editing ? (
        <TokenForm
          onSaved={() => {
            setToken(true)
            setEditing(false)
            setPhase({ name: 'idle' })
          }}
          onCancel={token ? () => setEditing(false) : undefined}
        />
      ) : listening ? (
        <div className="flex flex-col gap-2.5">
          <p aria-live="polite" className="text-xs text-ink-2">
            {input === 'mic' ? tr('Listening… {n} s', { n: Math.max(0, Math.ceil(SECONDS - listening.seconds)) }) : tr('Listening to this PC… {n} s', { n: Math.max(0, Math.ceil(SECONDS - listening.seconds)) })}
          </p>
          <span className="h-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-100" style={{ width: `${Math.min(100, (listening.seconds / SECONDS) * 100)}%` }} />
          </span>
          <span className="flex items-center gap-2 text-ink-3" title={input === 'mic' ? tr('Microphone level') : tr('Sound level')}>
            {input === 'mic' ? <Microphone size={13} /> : <Desktop size={13} />}
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-ink-2 transition-[width] duration-100" style={{ width: `${Math.round(listening.level * 100)}%` }} />
            </span>
          </span>
          <Button variant="ghost" onClick={() => void api.detectStop()} className="self-start">
            {tr('Stop')}
          </Button>
        </div>
      ) : (
        <>
          <Segmented
            label={tr('Listen to')}
            value={input}
            onChange={(detectorInput) => useSettings.getState().update({ detectorInput })}
            options={[
              { value: 'mic', label: tr('Microphone') },
              { value: 'pc', label: tr('This PC') },
            ]}
          />
          <p className="text-xs text-ink-2">{input === 'mic' ? tr('A song playing around you? Music App listens for {n} seconds and names it.', { n: SECONDS }) : tr('A song playing in another app or a video? Music App listens to this PC for {n} seconds and names it.', { n: SECONDS })}</p>
          {phase.name === 'note' && (
            <p className="text-xs text-ink">
              {phase.text}{' '}
              {phase.mic && (
                <button onClick={() => void api.openWindowsSettings('microphone')} className="font-medium underline-offset-2 hover:underline">
                  {tr('Open Windows settings')}
                </button>
              )}
            </p>
          )}
          <Button onClick={() => void listen()} disabled={token === null} className="self-start">
            {input === 'mic' ? <Microphone size={15} weight="fill" /> : <Desktop size={15} weight="fill" />} {tr('Listen')}
          </Button>
          <button onClick={() => setEditing(true)} className="self-start text-[11px] text-ink-3 hover:text-ink">
            {tr('AudD token · Change')}
          </button>
        </>
      )}
      {phase.name === 'consent' && (
        <Dialog title={phase.input === 'mic' ? tr('Identify songs with the microphone') : tr('Identify songs playing on this PC')} onClose={() => setPhase({ name: 'idle' })}>
          <p className="text-sm text-ink-2">
            {phase.input === 'mic'
              ? tr('Music App listens through your microphone for {n} seconds. The sound stays in memory, goes once to AudD (audd.io) to name the song, then is dropped: nothing is saved. Your music pauses while it listens.', { n: SECONDS })
              : tr('Music App listens to what this PC plays (every app) for {n} seconds. The sound stays in memory, goes once to AudD (audd.io) to name the song, then is dropped: nothing is saved. Music App’s own music pauses while it listens, so it’s never part of it.', { n: SECONDS })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPhase({ name: 'idle' })}>
              {tr('Not now')}
            </Button>
            <Button
              onClick={() => {
                useSettings.getState().update(phase.input === 'mic' ? { detector: true } : { detectorPc: true })
                setPhase({ name: 'idle' })
                void listen()
              }}
            >
              {tr('Allow and listen')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

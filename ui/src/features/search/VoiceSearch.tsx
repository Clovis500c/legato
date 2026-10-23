import { Microphone, Waveform } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type VoiceMiss } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { msg, tr } from '../../shared/i18n/i18n'

type Step = { name: 'ask' } | { name: 'listening'; heard: string } | { name: 'miss'; miss: VoiceMiss }

const MISSES: Record<VoiceMiss, string> = {
  speechOff: msg('Windows’ online speech recognition is off. Turn it on in Windows settings › Privacy & security › Speech, then try again.'),
  micBlocked: msg('Windows keeps desktop apps away from the microphone. Allow them in Windows settings › Privacy & security › Microphone.'),
  noMic: msg('No microphone found.'),
  silence: msg('Nothing heard. Try again, a bit closer to the microphone.'),
  unclear: msg('Didn’t catch that. Try again.'),
  offline: msg('Voice search needs the internet.'),
  language: msg('Windows’ speech language can’t do this. Pick another in Windows settings › Time & language › Speech.'),
  canceled: '',
  failed: msg('Voice search didn’t work this time.'),
}
const FIX: Partial<Record<VoiceMiss, 'speech' | 'microphone'>> = { speechOff: 'speech', micBlocked: 'microphone' }

/**
 * Mic inside the search bar's pill. Two choices: say it and it searches (src-tauri speech.rs, Windows' speech
 * recognition; asked once before the first use: the voice goes to Microsoft's service through Windows while the mic
 * listens), or name the song playing around you (Music Detector, Add music).
 */
export function VoiceSearch() {
  const agreed = useSettings((s) => s.settings.voiceSearch)
  const [step, setStep] = useState<Step | null>(null)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  // Bumped per listen: a late answer from a stopped one is ignored.
  const run = useRef(0)

  const listen = async () => {
    const n = ++run.current
    setStep({ name: 'listening', heard: '' })
    const off = await api.onSpeech((heard) => run.current === n && setStep({ name: 'listening', heard }))
    try {
      const r = await api.voiceListen()
      if (run.current !== n) return
      if (r.kind === 'text') {
        setStep(null)
        useStore.getState().setQuery(r.text)
        useStore.getState().searchFor(r.text)
      } else setStep(r.miss === 'canceled' ? null : { name: 'miss', miss: r.miss })
    } catch {
      if (run.current === n) setStep({ name: 'miss', miss: 'failed' })
    } finally {
      off()
    }
  }
  const close = () => {
    run.current++
    setStep(null)
    void api.voiceStop()
  }
  // Leaving the app's window with the dialog open (Escape is handled by the dialog).
  useEffect(() => () => void api.voiceStop(), [])
  const fix = step?.name === 'miss' ? FIX[step.miss] : undefined

  return (
    <>
      <button
        type="button"
        aria-label={tr('Microphone: search by voice or identify a song')}
        title={tr('Search by voice or identify a song')}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-raised hover:text-ink"
      >
        <Microphone size={17} />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div role="menu" onKeyDown={(e) => e.key === 'Escape' && setMenu(null)} className="fixed z-50 flex w-64 flex-col gap-1 rounded-xl border border-line bg-raised p-1.5 shadow-[0_12px_32px_var(--shadow)]" style={{ top: menu.bottom + 6, left: Math.max(8, menu.right - 256) }}>
            {[
              { icon: <Microphone size={18} />, label: tr('Search by voice'), note: tr('Say a song, an artist…'), run: () => (agreed ? void listen() : setStep({ name: 'ask' })) },
              { icon: <Waveform size={18} />, label: tr('Identify a song'), note: tr('Name the music playing around you'), run: () => useStore.getState().identifySong() },
            ].map((o, i) => (
              <button
                key={i}
                role="menuitem"
                autoFocus={i === 0}
                onClick={() => {
                  setMenu(null)
                  o.run()
                }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-bg focus-visible:bg-bg"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bg text-ink-2">{o.icon}</span>
                <span className="flex flex-col">
                  <span className="text-[0.8125rem] font-semibold">{o.label}</span>
                  <span className="text-[0.6875rem] text-ink-2">{o.note}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {step && (
        <Dialog title={tr('Search with your voice')} onClose={close}>
          {step.name === 'ask' && (
            <>
              <p className="text-sm text-ink-2">
                {tr('Voice search uses Windows’ own speech recognition: while the microphone listens, your voice goes to Microsoft’s speech service through Windows. Music App keeps nothing, and nothing goes to us.')}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>
                  {tr('Not now')}
                </Button>
                <Button
                  onClick={() => {
                    useSettings.getState().update({ voiceSearch: true })
                    void listen()
                  }}
                >
                  {tr('Turn on voice search')}
                </Button>
              </div>
            </>
          )}
          {step.name === 'listening' && (
            <div className="flex flex-col items-center gap-5 py-4">
              <p aria-live="polite" className="min-h-7 text-center text-lg font-semibold">
                {step.heard || tr('Listening…')}
              </p>
              <span className="relative grid size-18 place-items-center">
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent opacity-30" />
                <span className="relative grid size-18 place-items-center rounded-full bg-accent text-bg">
                  <Microphone size={30} weight="fill" />
                </span>
              </span>
              <Button variant="ghost" onClick={close}>
                {tr('Stop')}
              </Button>
            </div>
          )}
          {step.name === 'miss' && (
            <>
              <p className="text-sm text-ink-2">{tr(MISSES[step.miss])}</p>
              <div className="flex justify-end gap-2">
                {fix && (
                  <Button variant="ghost" onClick={() => void api.openWindowsSettings(fix)}>
                    {tr('Open Windows settings')}
                  </Button>
                )}
                <Button onClick={() => void listen()}>{tr('Try again')}</Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  )
}

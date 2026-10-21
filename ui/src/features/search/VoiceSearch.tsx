import { Microphone } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type VoiceMiss } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'

type Step = { name: 'ask' } | { name: 'listening'; heard: string } | { name: 'miss'; miss: VoiceMiss }

const MISSES: Record<VoiceMiss, string> = {
  speechOff: 'Windows’ online speech recognition is off. Turn it on in Windows settings › Privacy & security › Speech, then try again.',
  micBlocked: 'Windows keeps desktop apps away from the microphone. Allow them in Windows settings › Privacy & security › Microphone.',
  noMic: 'No microphone found.',
  silence: 'Nothing heard. Try again, a bit closer to the microphone.',
  unclear: 'Didn’t catch that. Try again.',
  offline: 'Voice search needs the internet.',
  language: 'Windows’ speech language can’t do this. Pick another in Windows settings › Time & language › Speech.',
  canceled: '',
  failed: 'Voice search didn’t work this time.',
}
const FIX: Partial<Record<VoiceMiss, 'speech' | 'microphone'>> = { speechOff: 'speech', micBlocked: 'microphone' }

/**
 * Mic beside the search bar, like YouTube's: say it, it searches (src-tauri speech.rs, Windows' speech recognition).
 * Asked once before the first use: the voice goes to Microsoft's service through Windows while the mic listens.
 */
export function VoiceSearch() {
  const agreed = useSettings((s) => s.settings.voiceSearch)
  const [step, setStep] = useState<Step | null>(null)
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
        aria-label="Search with your voice"
        title="Search with your voice"
        onClick={() => (agreed ? void listen() : setStep({ name: 'ask' }))}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink-2 hover:text-ink"
      >
        <Microphone size={17} />
      </button>
      {step && (
        <Dialog title="Search with your voice" onClose={close}>
          {step.name === 'ask' && (
            <>
              <p className="text-sm text-ink-2">
                Voice search uses Windows’ own speech recognition: while the microphone listens, your voice goes to Microsoft’s speech service through Windows. Music App keeps nothing, and nothing goes to us.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>
                  Not now
                </Button>
                <Button
                  onClick={() => {
                    useSettings.getState().update({ voiceSearch: true })
                    void listen()
                  }}
                >
                  Turn on voice search
                </Button>
              </div>
            </>
          )}
          {step.name === 'listening' && (
            <div className="flex flex-col items-center gap-5 py-4">
              <p aria-live="polite" className="min-h-7 text-center text-lg font-semibold">
                {step.heard || 'Listening…'}
              </p>
              <span className="relative grid size-18 place-items-center">
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent opacity-30" />
                <span className="relative grid size-18 place-items-center rounded-full bg-accent text-bg">
                  <Microphone size={30} weight="fill" />
                </span>
              </span>
              <Button variant="ghost" onClick={close}>
                Stop
              </Button>
            </div>
          )}
          {step.name === 'miss' && (
            <>
              <p className="text-sm text-ink-2">{MISSES[step.miss]}</p>
              <div className="flex justify-end gap-2">
                {fix && (
                  <Button variant="ghost" onClick={() => void api.openWindowsSettings(fix)}>
                    Open Windows settings
                  </Button>
                )}
                <Button onClick={() => void listen()}>Try again</Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  )
}

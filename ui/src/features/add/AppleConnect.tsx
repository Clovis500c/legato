import { AppleLogo } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type SpotifyList, type SpotifyPick } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { Card } from './Card'
import { ListPick } from './ListPick'

// Apple's terms: said once on this PC, before its page is first read.
const AGREED = 'apple-rules-read'

const agreed = () => {
  try {
    return localStorage.getItem(AGREED) === '1'
  } catch {
    return false
  }
}

const remember = () => {
  try {
    localStorage.setItem(AGREED, '1')
  } catch {
    // Said again next time.
  }
}

type Step = 'rules' | 'sign-in' | 'reading' | 'pick'

/**
 * Apple Music's playlists, Favorite Songs included (user's choice 2026-10-31): Apple's own page in a window, the user
 * signs in there, its playlists are read (against Apple's terms, the dialog says so; src-tauri/src/apple_web.rs) and
 * ticked here, each song then found on YouTube. Its button goes where Spotify's does: Add music, Settings › Accounts.
 */
export function AppleImport({ label, className }: { label: string; className?: string }) {
  const [step, setStep] = useState<Step>()
  const [lists, setLists] = useState<SpotifyList[]>([])

  const close = () => {
    setStep(undefined)
    void api.appleWebClose().catch(() => {})
  }
  const fail = (e: unknown) => {
    close()
    useStore.setState({ error: String(e) })
  }
  const signIn = () => {
    setStep('sign-in')
    api.appleWebOpen().catch(fail)
  }

  // The session cookie is the sign-in's end (the window stays: it reads next).
  useEffect(() => {
    if (step !== 'sign-in') return
    const id = setInterval(() => {
      void api.appleWebStatus().then((on) => on && setStep((s) => (s === 'sign-in' ? 'reading' : s)), () => {})
    }, 1500)
    return () => clearInterval(id)
  }, [step])

  useEffect(() => {
    if (step !== 'reading') return
    let live = true
    api.appleLists().then(
      (found) => {
        if (!live) return
        if (!found.length) return fail(tr('No playlists were found in your Apple Music library.'))
        setLists(found)
        setStep('pick')
      },
      (e) => {
        if (live) fail(e)
      },
    )
    return () => {
      live = false
    }
  }, [step])

  const start = (picks: SpotifyPick[]) => {
    setStep(undefined)
    void useStore.getState().importSpotifyLists(() => api.appleImport(picks), 'apple')
  }

  return (
    <>
      <Button className={className} onClick={() => (agreed() ? signIn() : setStep('rules'))}>
        {label}
      </Button>
      {step === 'rules' && (
        <Dialog title={tr('Before you connect')} onClose={close}>
          <p className="text-sm text-ink-2">{tr('Legato opens Apple Music’s own page and reads your playlists as they appear on it. Your password stays with Apple, and each song is then found on YouTube.')}</p>
          <p className="text-sm text-ink-2">{tr('Apple’s terms forbid reading its services with an automated tool. We know of no account closed for it, but we can’t rule it out: the choice is yours.')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {tr('Cancel')}
            </Button>
            <Button
              onClick={() => {
                remember()
                signIn()
              }}
            >
              {tr('I understand, continue')}
            </Button>
          </div>
        </Dialog>
      )}
      {(step === 'sign-in' || step === 'reading') && (
        <Dialog title={tr('Connect Apple Music')} onClose={close}>
          <p role="status" className="text-sm text-ink-2">
            {step === 'sign-in' ? tr('Sign in on Apple Music’s page. The next step comes by itself.') : tr('Reading your playlists on Apple Music…')}
          </p>
        </Dialog>
      )}
      {step === 'pick' && <ListPick title={tr('Your Apple Music playlists')} lists={lists} onClose={close} onStart={start} />}
    </>
  )
}

export function AppleConnect() {
  return (
    <Card icon={AppleLogo} title={tr('Connect Apple Music')} sub={tr('Import your Apple Music playlists, Favorite Songs included.')}>
      <AppleImport className="mt-auto self-start" label={tr('Connect')} />
    </Card>
  )
}

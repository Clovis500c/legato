import { SpotifyLogo } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type SpotifyList } from '../../shared/api'
import { remoteArt } from '../../shared/art'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'
import { Card } from './Card'

// Liked Songs has no playlist of its own on Spotify (music_connectors::spotify_page::LIKED).
const LIKED = 'liked'
// Spotify's rules: said once on this PC, before the first connection.
const AGREED = 'spotify-rules-read'

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
 * Connect Spotify: any free account, private playlists and Liked Songs. The user signs in on Spotify's page, ticks lists
 * here, the import runs in a toast. Rust reads the page (src-tauri/src/spotify_web.rs).
 */
export function SpotifyConnect() {
  const [step, setStep] = useState<Step>()
  const [lists, setLists] = useState<SpotifyList[]>([])
  const [off, setOff] = useState<string[]>([])

  const close = () => {
    setStep(undefined)
    void api.spotifyWebClose().catch(() => {})
  }
  const signIn = () => {
    setStep('sign-in')
    api.spotifyWebOpen().catch((e) => {
      setStep(undefined)
      useStore.setState({ error: String(e) })
    })
  }

  // The session cookie is the sign-in's end (the window stays: it reads next).
  useEffect(() => {
    if (step !== 'sign-in') return
    const id = setInterval(() => {
      void api.spotifyWebStatus().then((on) => on && setStep((s) => (s === 'sign-in' ? 'reading' : s)), () => {})
    }, 1500)
    return () => clearInterval(id)
  }, [step])

  useEffect(() => {
    if (step !== 'reading') return
    let live = true
    api.spotifyLists().then(
      (found) => {
        if (!live) return
        setLists([{ id: LIKED, name: tr('Liked Songs'), cover: null }, ...found])
        setOff([])
        setStep('pick')
      },
      (e) => {
        if (!live) return
        close()
        useStore.setState({ error: String(e) })
      },
    )
    return () => {
      live = false
    }
  }, [step])

  const ticked = lists.filter((l) => !off.includes(l.id))
  const start = () => {
    setStep(undefined)
    void useStore.getState().importSpotifyLists(ticked.map((l) => ({ id: l.id, name: l.name })))
  }

  return (
    <Card icon={SpotifyLogo} title={tr('Connect Spotify')} sub={tr('Import your playlists and Liked Songs, private ones too, with any free account.')}>
      <Button className="mt-auto self-start" onClick={() => (agreed() ? signIn() : setStep('rules'))}>
        {tr('Connect')}
      </Button>
      {step === 'rules' && (
        <Dialog title={tr('Before you connect')} onClose={close}>
          <p className="text-sm text-ink-2">{tr('Legato opens Spotify’s own page and reads your lists as they appear on it. Your password stays with Spotify, and each song is then found on YouTube.')}</p>
          <p className="text-sm text-ink-2">{tr('Spotify’s rules forbid collecting its data with a tool and allow it to close an account that does. We know of no such case, but we can’t rule it out: the choice is yours.')}</p>
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
        <Dialog title={tr('Connect Spotify')} onClose={close}>
          <p role="status" className="text-sm text-ink-2">
            {step === 'sign-in' ? tr('Sign in on Spotify’s page. The next step comes by itself.') : tr('Reading your library on Spotify…')}
          </p>
        </Dialog>
      )}
      {step === 'pick' && (
        <Dialog title={tr('Your Spotify lists')} onClose={close}>
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {lists.map((l) => (
              <li key={l.id}>
                <label className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-raised">
                  <input type="checkbox" className="size-3.5 accent-ink" checked={!off.includes(l.id)} onChange={(e) => setOff(e.target.checked ? off.filter((id) => id !== l.id) : [...off, l.id])} />
                  <Cover title={l.name} art={l.cover ? [remoteArt(l.cover)] : []} size={32} />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{l.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setOff(ticked.length ? lists.map((l) => l.id) : [])}>
              {ticked.length ? tr('Clear selection') : tr('Select all')}
            </Button>
            <Button disabled={!ticked.length} onClick={start}>
              {trn(ticked.length, 'Import {n} list', 'Import {n} lists')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}

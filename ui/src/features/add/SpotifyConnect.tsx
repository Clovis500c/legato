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

// Liked Songs has no playlist of its own on Spotify (music_core::spotify_export::LIKED, spotify_page::LIKED).
const LIKED = 'liked'
// Spotify's rules: said once on this PC, before its page is first read.
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

type Step = 'export' | 'rules' | 'sign-in' | 'reading' | 'pick'

/**
 * Spotify's playlists and Liked Songs, private ones too, any account. First way: Exportify's page in a window, driven by
 * the app (official API, src-tauri/src/spotify_export.rs): every list comes straight in. Second way, for when it's gone:
 * Spotify's own page read (against its rules, the dialog says so; src-tauri/src/spotify_web.rs), lists ticked here.
 */
export function SpotifyConnect() {
  const [step, setStep] = useState<Step>()
  const [lists, setLists] = useState<SpotifyList[]>([])
  const [off, setOff] = useState<string[]>([])

  const close = () => {
    setStep(undefined)
    void api.spotifyWebClose().catch(() => {})
    void api.spotifyExportClose().catch(() => {})
  }
  const fail = (e: unknown) => {
    close()
    useStore.setState({ error: String(e) })
  }
  const pick = (found: SpotifyList[]) => {
    setLists(found.map((l) => (l.id === LIKED ? { ...l, name: tr('Liked Songs') } : l)))
    setOff([])
    setStep('pick')
  }
  const exportify = () => {
    setStep('export')
    api.spotifyExportOpen().catch(fail)
  }
  const signIn = () => {
    setStep('sign-in')
    api.spotifyWebOpen().catch(fail)
  }
  const readPage = () => {
    void api.spotifyExportClose().catch(() => {})
    if (agreed()) signIn()
    else setStep('rules')
  }

  useEffect(() => {
    if (step !== 'export') return
    let taken = false
    const off = api.onSpotifyExport(({ lists: found, error }) => {
      if (taken) return
      taken = true
      if (error) return fail(error)
      setStep(undefined)
      const picks = found.map((l) => ({ id: l.id, name: l.id === LIKED ? tr('Liked Songs') : l.name }))
      void useStore.getState().importSpotifyLists(() => api.spotifyExportImport(picks))
    })
    return () => void off.then((f) => f())
  }, [step])

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
        if (live) pick([{ id: LIKED, name: '', cover: null, songs: null }, ...found])
      },
      (e) => {
        if (live) fail(e)
      },
    )
    return () => {
      live = false
    }
  }, [step])

  const ticked = lists.filter((l) => !off.includes(l.id))
  const start = () => {
    const picks = ticked.map((l) => ({ id: l.id, name: l.name }))
    setStep(undefined)
    void useStore.getState().importSpotifyLists(() => api.spotifyImport(picks))
  }

  return (
    <Card icon={SpotifyLogo} title={tr('Connect Spotify')} sub={tr('Import your playlists and Liked Songs, private ones too, with any free account.')}>
      <Button className="mt-auto self-start" onClick={exportify}>
        {tr('Connect')}
      </Button>
      {step === 'export' && (
        <Dialog title={tr('Connect Spotify')} onClose={close}>
          <p className="text-sm text-ink-2">{tr('Exportify, a free open-source tool, reads your lists in a window. If Spotify’s page asks, sign in and accept: everything else happens by itself.')}</p>
          <p role="status" className="text-sm text-ink-3">
            {tr('Waiting for your lists…')}
          </p>
          <Button variant="ghost" className="self-end" onClick={readPage}>
            {tr('Read Spotify’s page instead')}
          </Button>
        </Dialog>
      )}
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
                  {l.songs !== null && <span className="text-xs text-ink-3">{trn(l.songs, '{n} song', '{n} songs')}</span>}
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

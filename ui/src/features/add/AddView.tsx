import { ArrowRight, ClipboardText, FolderPlus, ListPlus, MagnifyingGlass, QrCode } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../app/store'
import { api, type Track } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Card } from './Card'
import { Detector } from './Detector'

const FIELD = 'h-9 min-w-0 rounded-md border border-line bg-raised px-3 text-[0.8125rem] placeholder:text-ink-3'

/** The main way in: search here, results on the Search page (a song found is added with its YouTube version). */
function SearchHero() {
  const { searchFor, ytOn } = useStore(useShallow((s) => ({ searchFor: s.searchFor, ytOn: s.status.youtube.connected })))
  const [q, setQ] = useState('')
  const sources = [
    { code: 'YouTube', note: tr('Every video, no account needed'), on: true },
    { code: 'YouTube Music', note: ytOn ? tr('Songs, with your Google account') : tr('Sign in with Google (Accounts)'), on: ytOn },
    { code: 'Apple Music', note: tr('Public catalog, no account'), on: true },
    { code: 'Spotify', note: tr('Search closed without Premium'), on: false },
  ]
  return (
    <section className="flex max-w-3xl flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) searchFor(q.trim())
        }}
        className="flex h-14 items-center gap-3 rounded-full border border-line bg-raised pr-2 pl-5 transition-colors focus-within:border-ink-3"
      >
        <MagnifyingGlass size={22} className="shrink-0 text-ink-2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Song, artist or album')} aria-label={tr('Search')} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3" />
        <Button type="submit" disabled={!q.trim()}>
          {tr('Search')}
        </Button>
      </form>
      <div className="flex flex-col gap-2 px-5 text-xs text-ink-2">
        <p className="text-[0.8125rem]">{tr('Search for a track: it’s added to your library, with its YouTube version when one exists.')}</p>
        <ul aria-label={tr('Search sources')} className="flex flex-wrap gap-x-4 gap-y-1.5">
          {sources.map((s) => (
            <li key={s.code} title={s.note} className="flex items-center gap-1.5">
              <Led on={s.on} /> {s.code}
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2">
          <ClipboardText size={15} className="shrink-0" />
          <span>
            <span className="font-medium text-ink">{tr('Paste a YouTube link')}</span> {tr('anywhere (Ctrl+V): the track is added right away.')}
          </span>
        </p>
      </div>
    </section>
  )
}

/** Shared playlist: link or QR text typed / pasted here (Ctrl+V anywhere works too). */
function ImportCode() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const digits = /^\d{3}\s?\d{3}$/.test(text.trim())
  return (
    <Card icon={QrCode} title={tr('Import a shared playlist')} sub={busy ? tr('Looking for the sender on this network…') : tr('Paste a legato:// link, type a 6-digit code from a nearby Legato, or drop a QR screenshot on the window.')}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          setBusy(true)
          try {
            // 6 digits = nearby sender; else link or QR text.
            useStore.setState({ incoming: digits ? await api.nearbyReceive(text) : text.trim() })
            setText('')
          } catch (err) {
            useStore.setState({ error: String(err) })
          } finally {
            setBusy(false)
          }
        }}
        className="mt-auto flex gap-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Link or 6-digit code')} aria-label={tr('Share link or code')} className={`${FIELD} flex-1 font-mono text-xs`} />
        <RoundButton label={tr('Import')} kind="ink" size="sm" type="submit" disabled={!text.trim() || busy}>
          <ArrowRight size={14} />
        </RoundButton>
      </form>
    </Card>
  )
}

/** Songs from anywhere (SoundCloud, Deezer, a friend's list): pasted in a dialog or from a .txt / .csv file, found on YouTube. */
function ImportList() {
  const [shown, setShown] = useState(false)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (path: string | null) => {
    setBusy(true)
    const done = await useStore.getState().importSongList(name, path ? null : text, path)
    setBusy(false)
    if (done) {
      setText('')
      setShown(false)
    }
  }
  const openFile = async () => {
    const file = await open({ filters: [{ name: tr('Song lists'), extensions: ['txt', 'csv', 'tsv'] }] })
    if (typeof file === 'string') void run(file)
  }
  return (
    <Card icon={ListPlus} title={tr('Import a list of songs')} sub={tr('One song per line, from SoundCloud, Deezer or anywhere: each is found on YouTube.')}>
      <span className="mt-auto flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => setShown(true)}>
          {busy ? tr('Importing…') : tr('Paste a list')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void openFile()}>
          {tr('Open a file…')}
        </Button>
      </span>
      {shown && (
        <Dialog title={tr('Import a list of songs')} onClose={() => setShown(false)}>
          <p className="text-sm text-ink-2">{tr('From SoundCloud, Deezer or anywhere: copy the titles, one per line like “Artist - Title”, and paste them here. Each song is found on YouTube.')}</p>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={tr('Daft Punk - Get Lucky')} aria-label={tr('Songs to import')} className="resize-y rounded-md border border-line bg-raised px-3 py-2 text-[0.8125rem] placeholder:text-ink-3" />
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={tr('Playlist name')} aria-label={tr('Playlist name')} className={FIELD} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShown(false)}>
              {tr('Cancel')}
            </Button>
            <Button disabled={busy || !text.trim()} onClick={() => void run(null)}>
              {busy ? tr('Importing…') : tr('Import')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}

/** Watched folder added right here (Settings › Sources lists and removes them). */
function AddFolder() {
  const refresh = useStore((s) => s.refresh)
  const [folders, setFolders] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.localFolders().then(setFolders, () => {})
  }, [])
  const add = async () => {
    const dir = await open({ directory: true, title: tr('Music folder') })
    if (typeof dir !== 'string' || folders.includes(dir)) return
    setBusy(true)
    try {
      await api.setLocalFolders([...folders, dir])
      setFolders(await api.localFolders())
      await refresh()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card icon={FolderPlus} title={tr('Add a music folder')} sub={tr('MP3, FLAC, WAV, OGG, M4A. Linked to your YouTube and Spotify tracks and played first, gapless.')}>
      {folders.length > 0 && (
        <p title={folders.join('\n')} className="truncate text-xs text-ink-3">
          {folders.map((f) => f.split(/[\\/]/).filter(Boolean).at(-1)).join(' · ')}
        </p>
      )}
      <Button disabled={busy} onClick={() => void add()} className="mt-auto self-start">
        {tr('Add folder')}
      </Button>
    </Card>
  )
}

export function AddView() {
  // Music Detector's song: searched for, shown above the results.
  const onFound = (t: Track) => useStore.getState().searchFor(`${t.artist} ${t.title}`, t)
  return (
    <>
      <PageHeader kicker={tr('Add · YouTube, YouTube Music, Apple Music and your files')} title={tr('Add music')} />
      <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-2 pb-6">
        <SearchHero />
        <div className="stagger grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          <Detector onFound={onFound} />
          <ImportList />
          <ImportCode />
          <AddFolder />
        </div>
      </div>
    </>
  )
}

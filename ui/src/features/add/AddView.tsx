import { ArrowRight, ClipboardText, FolderPlus, ListPlus, MagnifyingGlass, QrCode } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { api, type Track } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Detector } from './Detector'
import { tr } from '../../shared/i18n/i18n'

/** Shared playlist: link or QR text typed / pasted here (Ctrl+V anywhere works too). */
function ImportCode() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const digits = /^\d{3}\s?\d{3}$/.test(text.trim())
  return (
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
      className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3"
    >
      <p className="flex items-center gap-2 text-xs font-semibold">
        <QrCode size={16} className="text-ink-2" /> {tr('Import a shared playlist')}
      </p>
      <p className="text-xs text-ink-2">{busy ? tr('Looking for the sender on this network…') : tr('Paste a musicapp:// link, type a 6-digit code from a nearby Music App, or drop a QR screenshot on the window.')}</p>
      <span className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Link or 6-digit code')} aria-label={tr('Share link or code')} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 font-mono text-[0.6875rem] placeholder:text-ink-3" />
        <RoundButton label={tr('Import')} kind="ink" size="sm" type="submit" disabled={!text.trim() || busy}>
          <ArrowRight size={14} />
        </RoundButton>
      </span>
    </form>
  )
}

/** Songs from anywhere (SoundCloud, Deezer, a friend's list): pasted or from a .txt / .csv file, found on YouTube. */
function ImportList() {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (path: string | null) => {
    setBusy(true)
    const done = await useStore.getState().importSongList(name, path ? null : text, path)
    setBusy(false)
    if (done) setText('')
  }
  const openFile = async () => {
    const file = await open({ filters: [{ name: tr('Song lists'), extensions: ['txt', 'csv', 'tsv'] }] })
    if (typeof file === 'string') void run(file)
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-semibold">
        <ListPlus size={16} className="text-ink-2" /> {tr('Import a list of songs')}
      </p>
      <p className="text-xs text-ink-2">{tr('From SoundCloud, Deezer or anywhere: copy the titles, one per line like “Artist - Title”, and paste them here. Each song is found on YouTube.')}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={tr('Daft Punk - Get Lucky')} aria-label={tr('Songs to import')} className="resize-y rounded-md border border-line bg-raised px-2.5 py-2 text-xs placeholder:text-ink-3" />
      <span className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={tr('Playlist name')} aria-label={tr('Playlist name')} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 text-xs placeholder:text-ink-3" />
        <Button variant="ghost" disabled={busy} onClick={() => void openFile()}>
          {tr('Open a file…')}
        </Button>
        <Button disabled={busy || !text.trim()} onClick={() => void run(null)}>
          {busy ? tr('Importing…') : tr('Import')}
        </Button>
      </span>
    </div>
  )
}

/** Where the search went: the top bar (Ctrl+K), results on the Search page. */
const focusSearch = () => document.querySelector<HTMLInputElement>('[data-search]')?.focus()

export function AddView() {
  const { go, status } = useStore(useShallow(({ go, status }) => ({ go, status })))
  const ytOn = status.youtube.connected
  // Music Detector's song: searched for, shown above the results.
  const onFound = (t: Track) => useStore.getState().searchFor(`${t.artist} ${t.title}`, t)

  return (
    <>
      <PageHeader kicker={tr('Add · YouTube, YouTube Music, Apple Music and your files')} title={tr('Add music')} />
      <div className="flex min-h-0 flex-1 gap-8">
        <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-6">
          <div className="flex items-center gap-4 rounded-xl border border-line bg-raised px-5 py-4">
            <MagnifyingGlass size={22} className="shrink-0 text-ink-2" />
            <p className="flex-1 text-[0.8125rem] text-ink-2">{tr('Search for a track: it’s added to your library, with its YouTube version when one exists.')}</p>
            <Button onClick={focusSearch}>{tr('Search catalogs')}</Button>
          </div>
          <div className="rounded-xl border border-line px-4 py-2">
            <h2 className="kicker py-1.5">{tr('Search sources')}</h2>
            {[
              { code: 'YouTube', note: tr('Every video, no account needed'), on: true },
              { code: 'YouTube Music', note: ytOn ? tr('Songs, with your Google account') : tr('Sign in with Google (Accounts)'), on: ytOn },
              { code: 'Apple Music', note: tr('Public catalog, no account'), on: true },
              { code: 'Spotify', note: tr('Search closed without Premium'), on: false },
            ].map((s) => (
              <p key={s.code} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 text-[0.8125rem] first-of-type:border-0">
                <Led on={s.on} /> <span className="flex-1 font-medium">{s.code}</span>
                <span className="text-right text-[0.6875rem] text-ink-2">{s.note}</span>
              </p>
            ))}
          </div>
          <ImportList />
          <div className="flex items-start gap-3 rounded-xl border border-line px-4 py-3">
            <ClipboardText size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <p className="text-xs text-ink-2">
              <span className="font-semibold text-ink">{tr('Paste a YouTube link')}</span> {tr('anywhere (Ctrl+V): the track is added right away.')}
            </p>
          </div>
        </div>

        <aside className="scroll-quiet flex min-h-0 w-80 shrink-0 flex-col gap-4 overflow-y-auto pb-6">
          <Detector onFound={onFound} />
          <ImportCode />
          <button onClick={() => go({ name: 'settings', section: 'sources' })} className="flex items-start gap-3 rounded-xl border border-dashed border-ink-4 px-4 py-3 text-left hover:bg-raised">
            <FolderPlus size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <span className="text-xs text-ink-2">
              <span className="font-semibold text-ink">{tr('Add a music folder')}</span>
              {tr(': your files play first.')}
            </span>
          </button>
        </aside>
      </div>
    </>
  )
}

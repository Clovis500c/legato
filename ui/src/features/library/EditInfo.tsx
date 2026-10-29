import { Image, Trash } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type LibraryTrack } from '../../shared/api'
import { coverRewritten, trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'

const useEditInfo = create<{ track: LibraryTrack | null }>(() => ({ track: null }))

/** Right-click › Edit song info, on a local file. */
export const editInfo = (t: LibraryTrack) => useEditInfo.setState({ track: t })

/** Mounted once in App. */
export function EditInfoHost() {
  const t = useEditInfo((s) => s.track)
  return t && <EditInfo key={t.id} t={t} onClose={() => useEditInfo.setState({ track: null })} />
}

const field = 'rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-ink-3'

/** Title, artist, album and front cover written into the file itself (other players see them too). */
function EditInfo({ t, onClose }: { t: LibraryTrack; onClose: () => void }) {
  const [title, setTitle] = useState(t.title)
  const [artist, setArtist] = useState(t.artist)
  const [album, setAlbum] = useState(t.album ?? '')
  // undefined = cover kept, null = taken off, string = picture file picked.
  const [cover, setCover] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const pick = async () => {
    const file = await open({ filters: [{ name: tr('Pictures'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    if (typeof file === 'string') setCover(file)
  }
  const save = async () => {
    setBusy(true)
    try {
      await api.editTags(t.id, { title, artist, album: album.trim() || null, coverPath: cover ?? null, removeCover: cover === null })
      if (cover !== undefined) coverRewritten(t.id)
      await useStore.getState().refreshChanged()
      useStore.getState().notify(tr('Saved in the file'), { kind: 'ok' })
      onClose()
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const row = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-xs text-ink-2">
      {label}
      <input value={value} maxLength={500} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && artist.trim() && void save()} className={field} />
    </label>
  )
  return (
    <Dialog title={tr('Edit song info')} kicker={t.ids.local?.split(/[\\/]/).pop()} onClose={onClose}>
      <div className="flex gap-4">
        <div className="flex w-28 shrink-0 flex-col gap-2">
          <Cover title={title} art={cover === undefined ? trackArt(t) : []} size={112} />
          {typeof cover === 'string' && <p className="truncate text-[0.6875rem] text-ink-2" title={cover}>{tr('New: {name}', { name: cover.split(/[\\/]/).pop() ?? '' })}</p>}
          <Button variant="ghost" onClick={() => void pick()}>
            <Image size={14} /> {tr('Cover…')}
          </Button>
          {cover !== null && (
            <Button variant="ghost" onClick={() => setCover(null)}>
              <Trash size={14} /> {tr('No cover')}
            </Button>
          )}
        </div>
        <div className="flex min-w-64 flex-1 flex-col gap-3">
          {row(tr('Title'), title, setTitle)}
          {row(tr('Artist'), artist, setArtist)}
          {row(tr('Album'), album, setAlbum)}
          <p className="text-[0.6875rem] text-ink-3">{tr('Written into the file: other players see it too. The sound stays as it is.')}</p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tr('Cancel')}
        </Button>
        <Button data-default disabled={busy || !title.trim() || !artist.trim()} onClick={() => void save()}>
          {tr('Save')}
        </Button>
      </div>
    </Dialog>
  )
}

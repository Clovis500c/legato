import { Image, MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type SongRelease } from '../../shared/api'
import { coverRewritten, trackArt } from '../../shared/art'
import { pickFile } from '../../shared/files'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'
import { canSave, formOf, numberOk, startOf, tagsToWrite, type TagField, type TagForm, type TagStart, withRelease } from './tagForm'

const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-ink-3 aria-invalid:border-danger'

/**
 * Tags written into the files themselves (other players see them too), for one song or several (an album, a selection).
 * Several: a field they share starts with its value, one that differs starts empty and stays as each file has it unless
 * typed in; they can be numbered in their order.
 */
export function EditInfo({ tracks, onClose }: { tracks: LibraryTrack[]; onClose: () => void }) {
  const one = tracks.length === 1
  const first = tracks[0]
  const [start, setStart] = useState<TagStart | null>(null)
  const [form, setForm] = useState<TagForm | null>(null)
  const [number, setNumber] = useState(false)
  // undefined = cover kept, null = taken off, string = picture file picked.
  const [cover, setCover] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // MusicBrainz' releases of this song, once asked (one song only): null = not asked.
  const [releases, setReleases] = useState<SongRelease[] | null>(null)
  const [looking, setLooking] = useState(false)
  useEffect(() => {
    let live = true
    // Files not read: the library's title, artist and album to start from.
    void api
      .readTags(tracks.map((t) => t.id))
      .catch(() => [])
      .then((files) => {
        if (!live) return
        const s = startOf(tracks, files)
        setStart(s)
        setForm(formOf(s))
      })
    return () => {
      live = false
    }
  }, [tracks])
  const pick = async () => {
    const file = await pickFile({ filters: [{ name: tr('Pictures'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] }).catch((e) => void useStore.setState({ error: String(e) }))
    if (file) setCover(file)
  }
  const ok = !!form && !!start && canSave(form, start, one)
  const lookUp = async () => {
    if (!form) return
    setLooking(true)
    try {
      setReleases(await api.songReleases(form.title, form.artist, form.album, first.durationMs))
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
    } finally {
      setLooking(false)
    }
  }
  const save = async () => {
    if (!form || !start) return
    setBusy(true)
    try {
      const r = await api.editTags(
        tracks.map((t) => t.id),
        { ...tagsToWrite(form, start, { one, number }), coverPath: cover ?? null, removeCover: cover === null },
      )
      if (cover !== undefined) for (const t of tracks) coverRewritten(t.id)
      await useStore.getState().refreshChanged()
      const { notify } = useStore.getState()
      if (r.saved) notify(one ? tr('Saved in the file') : trn(r.saved, 'Saved in {n} file', 'Saved in {n} files'), { kind: 'ok' })
      if (r.failed.length) {
        const files = r.failed.slice(0, 3).join(', ') + (r.failed.length > 3 ? '…' : '')
        notify(tr('Not saved: {files}', { files }) + (r.reason ? ` (${r.reason})` : ''), { kind: 'error' })
      } else onClose()
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const input = (f: TagField, label: string, numeric = false) =>
    form && (
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-2">
        {label}
        <input
          value={form[f]}
          maxLength={numeric ? 4 : 500}
          inputMode={numeric ? 'numeric' : undefined}
          placeholder={start?.[f] === null ? tr('Several values: kept') : undefined}
          aria-invalid={numeric && !numberOk(form[f]) ? true : undefined}
          onChange={(e) => setForm({ ...form, [f]: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && ok && !busy && void save()}
          className={field}
        />
      </label>
    )
  return (
    <Dialog title={one ? tr('Edit song info') : trn(tracks.length, 'Edit info of {n} song', 'Edit info of {n} songs')} kicker={one ? first.ids.local?.split(/[\\/]/).pop() : undefined} onClose={onClose}>
      <div className="flex gap-4">
        <div className="flex w-28 shrink-0 flex-col gap-2">
          <Cover title={(one ? form?.title : form?.album) || first.title} art={cover === undefined ? trackArt(first) : []} size={112} />
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
        {form ? (
          <div className="flex min-w-64 flex-1 flex-col gap-3">
            {one && input('title', tr('Title'))}
            {input('artist', tr('Artist'))}
            {input('album', tr('Album'))}
            {input('albumArtist', tr('Album artist'))}
            <div className="flex gap-3">
              {input('genre', tr('Genre'))}
              {input('year', tr('Year'), true)}
            </div>
            <div className="flex gap-3">
              {input('bpm', tr('BPM'), true)}
              {input('key', tr('Key'))}
            </div>
            <div className="flex gap-3">
              {!number && input('track', tr('Track'), true)}
              {input('disc', tr('Disc'), true)}
            </div>
            {!one && (
              <label className="flex items-center gap-2 text-[0.8125rem]">
                <input type="checkbox" className="size-3.5 accent-ink" checked={number} onChange={(e) => setNumber(e.target.checked)} />
                {tr('Number them 1 to {n} in this order', { n: tracks.length })}
              </label>
            )}
            {one && (
              <div className="flex flex-col gap-1.5">
                <Button variant="ghost" disabled={looking || !form.title.trim() || !form.artist.trim()} onClick={() => void lookUp()} className="self-start">
                  <MagnifyingGlass size={14} /> {looking ? tr('Looking up…') : tr('Look up on MusicBrainz')}
                </Button>
                {releases && !releases.length && <p className="text-xs text-ink-2">{tr('MusicBrainz knows no release of this song')}</p>}
                {releases && releases.length > 0 && (
                  <ul aria-label={tr('Releases on MusicBrainz')} className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-line">
                    {releases.map((r, i) => (
                      <li key={i}>
                        <button
                          onClick={() => {
                            setForm(withRelease(form, r))
                            setReleases(null)
                          }}
                          className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-raised focus-visible:bg-raised"
                        >
                          <span className="truncate text-[0.8125rem] font-medium">{r.album}</span>
                          <span className="truncate text-xs text-ink-2">{[r.albumArtist, r.year, r.kind, r.track !== null && (r.tracks ? tr('Track {n} of {total}', { n: r.track, total: r.tracks }) : tr('Track {n}', { n: r.track })), r.disc !== null && r.disc > 1 && tr('Disc {n}', { n: r.disc }), r.country].filter(Boolean).join(' · ')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="text-[0.6875rem] text-ink-3">
              {one ? tr('Written into the file: other players see it too. The sound stays as it is.') : tr('Written into each file: only what you change, the rest stays as each file has it. The sound stays as it is.')}
            </p>
          </div>
        ) : (
          <p className="flex min-w-64 flex-1 items-center text-sm text-ink-2">{tr('Reading the files…')}</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tr('Cancel')}
        </Button>
        <Button data-default disabled={busy || !ok} onClick={() => void save()}>
          {tr('Save')}
        </Button>
      </div>
    </Dialog>
  )
}

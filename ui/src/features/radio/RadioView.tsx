import { Heart, Play, Radio } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type RadioStation } from '../../shared/api'
import { remoteArt } from '../../shared/art'
import { region } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { Cover } from '../../shared/ui/Cover'
import { Button } from '../../shared/ui/Button'
import { PageHeader } from '../../shared/ui/PageHeader'
import { usePlayer } from '../player/store'
import { stationQueue } from './station'
import { topGenres } from './suggest'

/**
 * Internet radio: search Radio Browser's open directory (the words typed go there, nothing else), play a station, keep
 * the ones you like. MP3 and Ogg stations come first; AAC ones (ADTS, AAC-LC) play too, HE-AAC and LATM ones may not.
 */
export function RadioView() {
  const [kept, setKept] = useState<RadioStation[]>([])
  const [found, setFound] = useState<RadioStation[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const fail = (e: unknown) => useStore.getState().notify(String(e), { kind: 'error' })
  // Starter stations, while none is kept: the user's region (the interface's language, never an IP lookup) and the genres of
  // their own library. Only a country code and up to two genre words go to the directory.
  const [starters, setStarters] = useState<RadioStation[]>([])
  const tracks = useStore((s) => s.tracks)
  const stats = useStore((s) => s.stats)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    api.radioKept().then((k) => (setKept(k), setLoaded(true)), fail)
  }, [])
  const asked = useRef(false)
  useEffect(() => {
    if (!loaded || kept.length || asked.current) return
    asked.current = true
    api.radioSuggest(region(), topGenres(tracks, stats)).then(setStarters, () => {})
  }, [loaded, kept.length, tracks, stats])
  const search = () => {
    if (!text.trim() || busy) return
    setBusy(true)
    api
      .radioSearch(text)
      .then(setFound, fail)
      .finally(() => setBusy(false))
  }
  const keep = (s: RadioStation, on: boolean) => api.radioKeep(s, on).then(setKept, fail)
  // Next and Previous go to the neighbour in the list the station was started from (results, or Your stations).
  const row = (list: RadioStation[]) => (s: RadioStation) => {
    const mine = kept.some((k) => k.id === s.id)
    return (
      <li key={s.id} className="flex items-center gap-3 border-t border-line-soft py-2.5">
        <Cover title={s.name} art={s.favicon ? [remoteArt(s.favicon)] : []} size={36} className="rounded-lg!" />
        <button type="button" aria-label={tr('Play {title}', { title: s.name })} onClick={() => {
            const q = stationQueue(list, s)
            usePlayer.getState().playTracks(q.tracks, q.index)
          }} className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink hover:brightness-110">
          <Play weight="fill" size={16} />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{s.name}</span>
          <span className="block truncate text-xs text-ink-2">{[s.country, s.codec, s.bitrate ? `${s.bitrate} kbit/s` : '', s.tags.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span>
        </span>
        <button type="button" aria-pressed={mine} aria-label={mine ? tr('Forget this station') : tr('Keep this station')} onClick={() => void keep(s, !mine)} className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink">
          <Heart weight={mine ? 'fill' : 'regular'} size={18} />
        </button>
      </li>
    )
  }
  return (
    <>
      <PageHeader title={tr('Radio')} sub={tr('Stations from the open Radio Browser directory. The words you type go there; nothing else is sent.')} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
        className="flex shrink-0 items-center gap-3 pb-4"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Station name')} aria-label={tr('Search radio stations')} className="min-w-0 flex-1 rounded-full border border-line bg-transparent px-4 py-2 text-sm outline-none placeholder:text-ink-3" />
        <Button type="submit" disabled={busy || !text.trim()}>
          {tr('Search')}
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {found && <h2 className="kicker pb-1">{found.length ? trn(found.length, '{n} station found', '{n} stations found') : tr('No station found.')}</h2>}
        {found && <ul className="flex flex-col">{found.map(row(found))}</ul>}
        <h2 className="kicker flex items-center gap-2 pt-6 pb-1">
          <Radio size={14} /> {tr('Your stations')}
        </h2>
        {!kept.length && starters.length > 0 && (
          <>
            <h2 className="kicker pt-6 pb-1">{tr('Stations to start with')}</h2>
            <p className="pb-1 text-xs text-ink-2">{tr('Picked from the directory for your region and the genres in your library. Only a country code and genre words were sent.')}</p>
            <ul className="flex flex-col">{starters.map(row(starters))}</ul>
          </>
        )}
        {kept.length ? <ul className="flex flex-col">{kept.map(row(kept))}</ul> : <p className="text-sm text-ink-2">{tr('Keep a station with its heart: it waits here.')}</p>}
      </div>
    </>
  )
}

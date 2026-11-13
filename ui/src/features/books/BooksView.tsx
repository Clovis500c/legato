import { Play } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useStore } from '../../app/store'
import { remoteArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { load } from '../player/resumeLong'
import { usePlayer } from '../player/store'
import { setEffects } from '../editor/editor'
import { songKey } from '../player/effects'
import { pickBooks, progress } from './books'
import { loadSpeeds, saveSpeeds, STEPS, withSpeed } from './speed'

/** Audiobooks (Settings › General › Audiobooks, off by default): the long local files apart from music, with where each was left. Playing one picks it up there. */
export function BooksView() {
  const tracks = useStore((s) => s.tracks)
  const books = useMemo(() => pickBooks(tracks), [tracks])
  const points = useMemo(load, [])
  const [speeds, setSpeeds] = useState(loadSpeeds)
  const pick = (key: string, v: number) => {
    const next = withSpeed(speeds, key, v)
    setSpeeds(next)
    saveSpeeds(next)
    // The book on now moves to it at once.
    if (songKey(usePlayer.getState().now) === key) setEffects({ tempo: v, on: true })
  }
  return (
    <>
      <PageHeader title={tr('Audiobooks')} sub={books.length ? trn(books.length, '{n} audiobook', '{n} audiobooks') : ''} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {books.length ? (
          <ul className="flex flex-col">
            {books.map((b, i) => {
              const p = progress(points, b)
              return (
                <li key={b.id} className="flex items-center gap-3 border-t border-line-soft py-2.5">
                  <Cover title={b.title} art={b.art ? [remoteArt(b.art)] : []} size={48} className="rounded-lg!" />
                  <button type="button" aria-label={tr('Play {title}', { title: b.title })} onClick={() => usePlayer.getState().playTracks(books, i)} className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink hover:brightness-110">
                    <Play weight="fill" size={16} />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{b.title}</span>
                    <span className="block truncate text-xs text-ink-2">{[b.artist, formatDuration(b.durationMs)].filter(Boolean).join(' · ')}</span>
                    <span className="mt-1 flex items-center gap-1 text-xs" role="group" aria-label={tr('Speed')}>
                      {STEPS.map((v) => (
                        <button key={v} type="button" aria-pressed={(speeds[`t:${b.id}`] ?? 1) === v} onClick={() => pick(`t:${b.id}`, v)} className={`rounded-full px-2 py-0.5 ${(speeds[`t:${b.id}`] ?? 1) === v ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink'}`}>
                          {v}×
                        </button>
                      ))}
                    </span>
                    {p && (
                      <span className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                        <span className="h-1 w-32 overflow-hidden rounded-full bg-recess" aria-hidden>
                          <span className="block h-full bg-ink-3" style={{ width: `${Math.round(p.share * 100)}%` }} />
                        </span>
                        {tr('{time} left', { time: formatDuration((b.durationMs ?? 0) - p.ms) })}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">{tr('No audiobook yet: a local file tagged as an audiobook, or two hours long and more, shows here.')}</p>
        )}
      </div>
    </>
  )
}

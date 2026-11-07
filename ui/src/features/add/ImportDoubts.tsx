import { CheckCircle } from '@phosphor-icons/react'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { api, type ImportDoubt, type Track } from '../../shared/api'
import { artistName } from '../../shared/artistName'
import { formatDuration } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'

/** The library song an import made of `song`: the one sharing a service id with it (YouTube's is the one in doubt). */
const libraryId = (song: Track) => useStore.getState().tracks.find((t) => Object.entries(song.ids).some(([s, id]) => s !== 'youtube' && t.ids[s as keyof typeof t.ids] === id))?.id

/**
 * Against Liner 9: an import's doubtful matches (their length doesn't back them), the videos side by side. The one
 * picked (first) keeps it, another takes its place (pickVersion, it stays), Approve all keeps every one.
 */
export function ImportDoubts({ doubts }: { doubts: ImportDoubt[] }) {
  const [settled, setSettled] = useState<number[]>([])
  const left = doubts.map((d, i) => ({ d, i })).filter(({ i }) => !settled.includes(i))
  if (!left.length) return null
  const settle = (i: number) => setSettled((s) => [...s, i])
  const pick = async (i: number, song: Track, video: Track) => {
    const id = libraryId(song)
    if (id === undefined) return settle(i)
    try {
      await api.pickVersion(id, video)
      settle(i)
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
    }
  }
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{trn(left.length, '{n} match to check', '{n} matches to check')}</p>
          <p className="text-xs text-ink-2">{tr('Its length doesn’t match the song’s: keep the video picked, or pick another.')}</p>
        </div>
        <Button variant="ghost" onClick={() => setSettled(doubts.map((_, i) => i))}>
          {tr('Approve all')}
        </Button>
      </div>
      <ul className="flex max-h-64 flex-col gap-2.5 overflow-y-auto">
        {left.map(({ d, i }) => (
          <li key={i} className="flex min-w-0 flex-col gap-1">
            <p className="truncate text-[0.8125rem] font-medium">
              {d.song.title} · {artistName(d.song.artist)} <span className="text-ink-3 tabular-nums">{formatDuration(d.song.durationMs)}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {d.candidates.map((v, n) => (
                <button key={v.ids.youtube ?? n} type="button" onClick={() => void (n === 0 ? settle(i) : pick(i, d.song, v))} className="flex max-w-full min-w-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-bg">
                  {n === 0 && <CheckCircle size={14} weight="fill" aria-label={tr('Picked')} className="shrink-0" />}
                  <span className="truncate">{v.title}</span>
                  <span className="shrink-0 text-ink-3 tabular-nums">{formatDuration(v.durationMs)}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

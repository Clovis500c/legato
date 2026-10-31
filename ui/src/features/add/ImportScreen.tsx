import { CheckCircle, SpotifyLogo } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { remoteArt } from '../../shared/art'
import { artistName } from '../../shared/artistName'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { Dialog } from '../../shared/ui/Dialog'
import { card, secondsLeft, share, summary, timeLeft, waitLeft, type ImportRun, type Seen } from './importRun'

function Deck({ seen }: { seen: Seen[] }) {
  const newest = seen.at(-1)?.seq ?? 0
  return (
    <div aria-hidden className="relative -mx-6 h-40 overflow-hidden">
      {seen.length === 0 && (
        <span className="absolute top-3 left-1/2 -ml-16 grid size-32 place-items-center rounded-cover border border-line-soft bg-raised text-ink-3">
          <SpotifyLogo size={40} />
        </span>
      )}
      {seen.map((s) => (
        <span key={s.seq} style={card(s, newest)} className="import-card absolute top-3 left-1/2 -ml-16">
          <Cover title={s.title} art={s.cover ? [remoteArt(s.cover)] : []} size={128} />
        </span>
      ))}
    </div>
  )
}

/** Time left and YouTube's limit, a line each. Read every second: a wait goes by with no news from the import. */
function Timing({ run }: { run: ImportRun }) {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  const now = Math.max(clock, run.marks.at(-1)?.at ?? 0)
  const left = secondsLeft(run, now)
  const wait = waitLeft(run, now)
  return (
    <>
      {!!run.progress?.toSearch && <p className="min-h-4 text-xs text-ink-3">{left !== undefined && timeLeft(left)}</p>}
      <p className="min-h-4 text-xs text-ink-3 tabular-nums">{wait !== undefined && (wait ? tr('YouTube is limiting searches: next try in {n} s', { n: wait }) : tr('YouTube is limiting searches: trying again'))}</p>
    </>
  )
}

/** Spotify's import: songs landing one by one, every list counted. Hide leaves a toast and the app free. */
export function ImportScreen() {
  const run = useStore((s) => s.importRun)
  const notFound = useStore((s) => s.notFound.length)
  if (!run || run.hidden) return null
  const { hideImport, endImport, go } = useStore.getState()
  const { progress: p, result, again } = run
  const open = () => {
    endImport()
    if (result?.playlistId != null) go({ name: 'playlist', id: result.playlistId })
  }
  const lost = () => {
    endImport()
    go({ name: 'notFound' })
  }
  const song = run.seen.at(-1)
  const done = p?.allTotal ? p.allDone : p?.done
  const total = p?.allTotal || p?.total
  const searching = p?.matching && !!p.toSearch
  return (
    <Dialog title={again ? (result ? tr('Search finished') : tr('Searching YouTube')) : result ? tr('Import finished') : tr('Importing from Spotify')} onClose={result ? endImport : hideImport}>
      <Deck seen={run.seen} />
      {result ? (
        <>
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle size={20} weight="fill" className="pop-in shrink-0" />
            {summary(result)}
          </p>
          {result.failed.length > 0 && <p className="text-sm text-ink-2">{tr('Not read: {lists}', { lists: result.failed.slice(0, 3).join(', ') + (result.failed.length > 3 ? '…' : '') })}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={endImport}>
              {tr('Close')}
            </Button>
            {notFound > 0 && (
              <Button variant="ghost" onClick={lost}>
                {trn(notFound, '{n} song not found', '{n} songs not found')}
              </Button>
            )}
            {result.playlistId !== null && <Button onClick={open}>{tr('Open')}</Button>}
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-col items-center text-center">
            <p className="w-full truncate text-sm font-medium">{song?.title ?? '\u00a0'}</p>
            <p className="w-full truncate text-[0.8125rem] text-ink-2">{song ? artistName(song.artist) : '\u00a0'}</p>
          </div>
          <div className="flex flex-col gap-2">
            <div role="progressbar" aria-label={tr('Importing from Spotify')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share(p) * 100)} className="h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full origin-left rounded-full bg-ink transition-transform duration-200 ease-out" style={{ transform: `scaleX(${share(p)})` }} />
            </div>
            <div className="flex justify-between gap-3 text-xs text-ink-2">
              <span className="min-w-0 truncate">{searching ? trn(p.toSearch, 'Searching YouTube for {n} song', 'Searching YouTube for {n} songs') : p ? tr('List {list} of {lists}: {name}', { list: p.list, lists: p.lists, name: p.name }) : tr('Importing…')}</span>
              {!!total && <span className="shrink-0 tabular-nums">{tr('{done} of {total} songs', { done: done ?? 0, total })}</span>}
            </div>
            <p className="min-h-4 text-xs text-ink-3 tabular-nums">{!!p?.playable && trn(p.playable, '{n} song playable', '{n} songs playable')}</p>
            <Timing run={run} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={hideImport}>
              {tr('Hide')}
            </Button>
            <Button variant="ghost" onClick={() => void api.importLinkStop()}>
              {tr('Cancel')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

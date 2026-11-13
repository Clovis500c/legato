import { Heart, Microphone, Play } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type PodcastFeed } from '../../shared/api'
import { remoteArt } from '../../shared/art'
import { formatDuration } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { usePlayer } from '../player/store'
import { episodeQueue } from './episode'

/**
 * Podcasts: the shows are open RSS feeds whose address you type (only that address is asked for; the episodes' audio comes
 * from the servers the feed names). Keep a show with its heart; an episode of 20 minutes and more starts again where it
 * was left, as any long song does.
 */
export function PodcastsView() {
  const [kept, setKept] = useState<PodcastFeed[]>([])
  const [show, setShow] = useState<PodcastFeed | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const fail = (e: unknown) => useStore.getState().notify(String(e), { kind: 'error' })
  useEffect(() => {
    api.podcastKept().then(setKept, fail)
  }, [])
  const open = (url: string) => {
    if (!url.trim() || busy) return
    setBusy(true)
    api
      .podcastFeed(url)
      .then(setShow, fail)
      .finally(() => setBusy(false))
  }
  const mine = show ? kept.some((k) => k.url === show.url) : false
  return (
    <>
      <PageHeader title={show ? show.title : tr('Podcasts')} sub={show ? show.author : tr('Open RSS feeds: type a feed’s address. Only that address is asked for; nothing else is sent.')} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          open(text)
        }}
        className="flex shrink-0 items-center gap-3 pb-4"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Feed address')} aria-label={tr('Podcast feed address')} className="min-w-0 flex-1 rounded-full border border-line bg-transparent px-4 py-2 text-sm outline-none placeholder:text-ink-3" />
        <Button type="submit" disabled={busy || !text.trim()}>
          {tr('Open')}
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {show ? (
          <>
            <div className="flex items-center gap-2 pb-2">
              <Button variant="ghost" onClick={() => setShow(null)}>
                {tr('Back')}
              </Button>
              <button type="button" aria-pressed={mine} aria-label={mine ? tr('Forget this podcast') : tr('Keep this podcast')} onClick={() => void api.podcastKeep(show, !mine).then(setKept, fail)} className="grid size-8 place-items-center rounded-full text-ink-2 hover:text-ink">
                <Heart weight={mine ? 'fill' : 'regular'} size={18} />
              </button>
              <span className="text-xs text-ink-2">{trn(show.episodes.length, '{n} episode', '{n} episodes')}</span>
            </div>
            <ul className="flex flex-col">
              {show.episodes.map((e) => (
                <li key={e.id} className="flex items-center gap-3 border-t border-line-soft py-2.5">
                  <button
                    type="button"
                    aria-label={tr('Play {title}', { title: e.title })}
                    onClick={() => {
                      const q = episodeQueue(show, e)
                      usePlayer.getState().playTracks(q.tracks, q.index)
                    }}
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink hover:brightness-110"
                  >
                    <Play weight="fill" size={16} />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="block truncate text-xs text-ink-2">{[e.published.slice(0, 16), e.durationMs ? formatDuration(e.durationMs) : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2 className="kicker flex items-center gap-2 pb-1">
              <Microphone size={14} /> {tr('Your podcasts')}
            </h2>
            {kept.length ? (
              <ul className="flex flex-col">
                {kept.map((k) => (
                  <li key={k.url} className="flex items-center gap-3 border-t border-line-soft py-2.5">
                    <Cover title={k.title} art={k.image ? [remoteArt(k.image)] : []} size={36} className="rounded-lg!" />
                    <button type="button" onClick={() => open(k.url)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">{k.title}</span>
                      <span className="block truncate text-xs text-ink-2">{k.author}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-2">{tr('Open a feed and keep it with its heart: it waits here.')}</p>
            )}
          </>
        )}
      </div>
    </>
  )
}

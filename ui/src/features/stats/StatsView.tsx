import { Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../app/store'
import { api, type Play as Listen } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { formatCount } from '../../shared/format'
import { tr, trn } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Segmented } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { trackMenu, tracksMenu } from '../menus'
import { usePlayer } from '../player/store'
import { statsOf, type Period } from './stats'

/** "12 h 30 min", "45 min". */
function hours(ms: number) {
  const min = Math.round(ms / 60_000)
  if (min < 60) return tr('{n} min', { n: min })
  const h = Math.floor(min / 60)
  return min % 60 ? tr('{h} h {m} min', { h: formatCount(h), m: min % 60 }) : tr('{n} h', { n: formatCount(h) })
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-raised px-4 py-3.5">
      <span className="text-xs text-ink-2">{label}</span>
      <span className="text-2xl font-bold tracking-[-0.02em] tabular-nums">{value}</span>
      {sub && <span className="text-xs text-ink-3">{sub}</span>}
    </div>
  )
}

function Block({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <h2 className="text-xl font-bold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  )
}

/** Vertical bars, one per value; labels under some of them. */
function Bars({ values, labels, tips }: { values: number[]; labels: (string | null)[]; tips: string[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-28 items-end gap-[3px]">
        {values.map((v, i) => (
          <span key={i} title={tips[i]} className="min-w-0 flex-1 rounded-t-sm bg-accent/75 transition-[height] hover:bg-accent" style={{ height: `${Math.max(v ? 4 : 1, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }} />
        ))}
      </div>
      <div className="flex gap-[3px] text-[0.625rem] text-ink-3">
        {labels.map((l, i) => (
          <span key={i} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {l ?? ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Your listening in numbers: time, top songs / artists / albums, when you listen, streaks. All from this PC's history. */
export function StatsView() {
  const { tracks, go } = useStore()
  const play = usePlayer((s) => s.playTracks)
  const [period, setPeriod] = useState<Period>('4w')
  const [history, setHistory] = useState<Listen[] | null>(null)
  useEffect(() => {
    api.playHistory(0).then(setHistory, () => setHistory([]))
  }, [])
  const s = useMemo(() => history && statsOf(history, tracks, period), [history, tracks, period])
  const lang = navigator.language
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: 'short' })), [lang])
  const bucket = (t: number) => new Date(t).toLocaleDateString(lang, period === 'year' || period === 'all' ? { month: 'short', year: period === 'all' ? '2-digit' : undefined } : { day: 'numeric', month: 'short' })

  const header = (
    <PageHeader
      title={tr('Your stats')}
      sub={tr('From what you played in Music App on this PC')}
      actions={<Segmented label={tr('Period')} value={period} onChange={setPeriod} options={[{ value: '4w', label: tr('4 weeks') }, { value: '6m', label: tr('6 months') }, { value: 'year', label: tr('This year') }, { value: 'all', label: tr('All time') }]} />}
    />
  )
  if (!s) return header
  if (!s.ms)
    return (
      <>
        {header}
        <p className="py-16 text-center text-ink-3">{tr('Nothing played in this period yet. Your stats fill up as you listen.')}</p>
      </>
    )
  const songs = s.topSongs.map((r) => r.item)
  const every = Math.ceil(s.timeline.starts.length / 8)
  return (
    <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-9 overflow-y-auto px-2 pb-8">
      {header}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <Tile label={tr('Time listened')} value={hours(s.ms)} />
        <Tile label={tr('Listens')} value={formatCount(s.listens)} />
        <Tile label={tr('Songs')} value={formatCount(s.songs)} />
        <Tile label={tr('Artists')} value={formatCount(s.artists)} sub={s.newArtists ? trn(s.newArtists, '{n} new', '{n} new') : undefined} />
        <Tile label={tr('Days in a row')} value={formatCount(s.streak)} sub={tr('Best: {n}', { n: formatCount(s.bestStreak) })} />
      </div>

      <div className="grid gap-9 lg:grid-cols-2">
        <Block title={tr('Top songs')}>
          <ol className="flex flex-col">
            {s.topSongs.map((r, i) => (
              <li key={r.item.id} onContextMenu={onMenu(() => trackMenu(r.item, { list: songs, index: i }))} onDoubleClick={() => play(songs, i)} className="group flex h-13 items-center gap-3.5 rounded-md px-2 hover:bg-raised">
                <span className="w-5 shrink-0 text-right text-xs text-ink-3 tabular-nums">
                  <span className="group-hover:hidden">{i + 1}</span>
                  <button aria-label={tr('Play {title}', { title: r.item.title })} onClick={() => play(songs, i)} className="hidden text-ink group-hover:inline">
                    <Play size={13} weight="fill" />
                  </button>
                </span>
                <Cover title={r.item.album ?? r.item.title} art={trackArt(r.item)} size={40} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.8125rem] font-semibold">{r.item.title}</span>
                  <span className="truncate text-xs text-ink-2">{r.item.artist}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-3 tabular-nums">{trn(r.listens, '{n} play', '{n} plays')}</span>
              </li>
            ))}
          </ol>
        </Block>
        <Block title={tr('Top artists')}>
          <ol className="flex flex-col">
            {s.topArtists.map((r, i) => (
              <li key={r.item.name}>
                <button onClick={() => go({ name: 'artist', artist: r.item.name })} className="flex h-13 w-full items-center gap-3.5 rounded-md px-2 text-left hover:bg-raised">
                  <span className="w-5 shrink-0 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
                  <Cover title={r.item.name} art={trackArt(r.item.cover)} size={40} className="rounded-full!" />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{r.item.name}</span>
                  <span className="shrink-0 text-xs text-ink-3 tabular-nums">{hours(r.ms)}</span>
                </button>
              </li>
            ))}
          </ol>
        </Block>
      </div>

      {s.topAlbums.length > 0 && (
        <Block title={tr('Top albums')}>
          <ul className="flex gap-5 overflow-x-auto pb-2">
            {s.topAlbums.map((r) => {
              const own = tracks.filter((t) => t.album === r.item.album)
              return (
                <li key={`${r.item.album}\u0000${r.item.artist}`} onContextMenu={onMenu(() => tracksMenu(own))} className="w-37.5 shrink-0">
                  <button onClick={() => go({ name: 'album', album: r.item.album, artist: r.item.artist })} className="group flex w-full flex-col gap-2 text-left">
                    <Cover title={r.item.album} art={trackArt(r.item.cover)} size={150} className="lift" />
                    <span className="truncate text-[0.8125rem] font-semibold group-hover:underline">{r.item.album}</span>
                    <span className="-mt-1.5 truncate text-xs text-ink-2">
                      {r.item.artist} · {trn(r.listens, '{n} play', '{n} plays')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Block>
      )}

      <Block title={tr('Over time')}>
        <Bars values={s.timeline.ms} labels={s.timeline.starts.map((t, i) => (i % every ? null : bucket(t)))} tips={s.timeline.starts.map((t, i) => `${bucket(t)}: ${hours(s.timeline.ms[i])}`)} />
      </Block>

      <div className="grid gap-9 lg:grid-cols-[2fr_1fr]">
        <Block title={tr('Time of day')}>
          <Bars values={s.byHour} labels={s.byHour.map((_, h) => (h % 3 ? null : `${h}h`))} tips={s.byHour.map((ms, h) => `${h}h: ${hours(ms)}`)} />
        </Block>
        <Block title={tr('Day of the week')}>
          <Bars values={s.byWeekday} labels={weekdays} tips={s.byWeekday.map((ms, d) => `${weekdays[d]}: ${hours(ms)}`)} />
        </Block>
      </div>
    </div>
  )
}

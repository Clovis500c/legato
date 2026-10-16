import { ArrowCounterClockwise, Play, Prohibit, ThumbsDown } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type Mix } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton } from '../../shared/ui/controls'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { PageHeader } from '../../shared/ui/PageHeader'
import { coverTracks } from '../library/covers'
import { TrackTable } from '../library/TrackTable'
import { tracksMenu } from '../menus'
import { usePlayer } from '../player/store'

/** Today's mixes; reload after a pref change or reset. */
export function useMixes() {
  const [mixes, setMixes] = useState<Mix[]>()
  const reload = useCallback(
    () =>
      api
        .mixes()
        .then(setMixes)
        .catch((e) => useStore.setState({ error: String(e) })),
    [],
  )
  useEffect(() => void reload(), [reload])
  return { mixes, reload }
}

function useMixTracks(mix?: Mix): LibraryTrack[] {
  const tracks = useStore((s) => s.tracks)
  return useMemo(() => {
    const byId = new Map(tracks.map((t) => [t.id, t]))
    return (mix?.trackIds ?? []).flatMap((id) => byId.get(id) ?? [])
  }, [tracks, mix])
}

/** Short label and big mark of a mix (template tile, badge on covers). */
function mixMark(mix: Mix): { label: string; mark: string } {
  const n = mix.id.match(/^daily-(\d)/)?.[1]
  if (n) return { label: 'Daily', mark: `0${n}` }
  const a = mix.id.match(/^artist-(\d)/)?.[1]
  if (a) return { label: 'Artist', mark: mix.title.replace(/ Mix$/, '').slice(0, 2).toUpperCase() }
  const marks: Record<string, { label: string; mark: string }> = {
    now: { label: 'Now', mark: '◐' },
    weekday: { label: 'Today', mark: mix.title.split(' ')[1]?.slice(0, 3).toUpperCase() ?? '◐' },
    repeat: { label: 'Repeat', mark: '∞' },
    fresh: { label: 'New', mark: '+' },
    gems: { label: 'Gems', mark: '◇' },
    rediscover: { label: 'Again', mark: '↺' },
  }
  return marks[mix.id] ?? { label: 'Mix', mark: '♪' }
}

/** Flat tile, mono label: no artwork needed, no gradient. */
function MixTile({ mix, size }: { mix: Mix; size: number }) {
  const { label, mark } = mixMark(mix)
  return (
    <span className="relative grid shrink-0 place-items-center rounded-cover border border-line-soft bg-recess" style={{ width: size, height: size }}>
      <span className="absolute top-3 left-3 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] text-ink-3 uppercase">
        <Led on /> {label}
      </span>
      <span className="font-mono font-semibold text-ink-2" style={{ fontSize: size * (mark.length > 2 ? 0.22 : 0.32) }}>
        {mark}
      </span>
    </span>
  )
}

/** Mix covers as set in Advanced: grid of 4 song covers (like playlists), the first cover, or the tile. */
function MixCover({ mix, tracks, size }: { mix: Mix; tracks: LibraryTrack[]; size: number }) {
  const style = useSettings((s) => s.settings.mixCovers)
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const songs = useMemo(() => (style === 'template' ? [] : coverTracks(mix.trackIds, byId, 'playlist', style === 'grid' ? 4 : 1)), [style, mix.trackIds, byId])
  if (!songs.length) return <MixTile mix={mix} size={size} />
  const { label } = mixMark(mix)
  return (
    <span className="relative shrink-0 overflow-hidden rounded-cover border border-line-soft bg-recess" style={{ width: size, height: size }}>
      {style === 'grid' && songs.length === 4 ? (
        <span className="grid size-full grid-cols-2">
          {songs.map((t) => (
            <img key={t.id} src={trackArt(t)[0]} alt="" draggable={false} loading="lazy" className="size-full object-cover" />
          ))}
        </span>
      ) : (
        <Cover title={mix.title} art={trackArt(songs[0])} size={size} className="rounded-none! border-0!" />
      )}
      {/* Badge on the art: fixed dark chip, readable over any cover. */}
      <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[9px] tracking-[0.08em] text-white uppercase">
        <span className="size-1.5 rounded-full bg-accent" /> {label}
      </span>
    </span>
  )
}

export function MixCard({ mix }: { mix: Mix }) {
  const go = useStore((s) => s.go)
  const play = usePlayer((s) => s.playTracks)
  const tracks = useMixTracks(mix)
  return (
    <li onContextMenu={onMenu(() => tracksMenu(tracks, ['-', { label: 'Open', onSelect: () => go({ name: 'mix', id: mix.id }) }]))} className="group relative flex w-[180px] shrink-0 flex-col gap-2">
      <button onClick={() => go({ name: 'mix', id: mix.id })} className="flex flex-col gap-2 text-left">
        <MixCover mix={mix} tracks={tracks} size={180} />
        <span className="block text-[13px] font-semibold group-hover:underline">{mix.title}</span>
        <span className="line-clamp-2 text-xs text-ink-2">{mix.reason}</span>
      </button>
      <RoundButton label={`Play ${mix.title}`} kind="primary" size="md" className="absolute top-[130px] left-[130px] opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => play(tracks, 0)}>
        <Play weight="fill" size={16} />
      </RoundButton>
    </li>
  )
}

const SECTIONS: { kind: Mix['kind']; title: string }[] = [
  { kind: 'daily', title: 'Your daily mixes' },
  { kind: 'moment', title: 'For right now' },
  { kind: 'favorites', title: 'Your favorites' },
  { kind: 'explore', title: 'Explore your library' },
]

function ResetHistory({ onDone }: { onDone: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        if (!confirm('Forget your listening history and “less / never” choices? Your library stays as it is.')) return
        await api.clearHistory().catch((e) => useStore.setState({ error: String(e) }))
        onDone()
      }}
    >
      <ArrowCounterClockwise size={14} /> Reset history
    </Button>
  )
}

export function MixesView() {
  const { mixes, reload } = useMixes()
  return (
    <>
      <PageHeader kicker="For you · made on this PC from what you play" title="Mixes" actions={<ResetHistory onDone={reload} />} />
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {mixes && mixes.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-ink-2">
            <p className="text-base text-ink">No mixes yet</p>
            <p>Play some music, or make a playlist: mixes appear after a few listens and change every day.</p>
          </div>
        )}
        <div className="flex flex-col gap-10">
          {SECTIONS.map(({ kind, title }) => {
            const list = mixes?.filter((m) => m.kind === kind) ?? []
            if (!list.length) return null
            return (
              <section key={kind} className="flex flex-col gap-4">
                <h2 className="kicker">{title}</h2>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-8">
                  {list.map((m) => (
                    <MixCard key={m.id} mix={m} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
        {mixes && mixes.length > 0 && <p className="mt-8 max-w-160 text-xs text-ink-2">Built from your plays (full listens count more, skips count against), your playlists, your saves on YouTube Music and Spotify, what you play back to back and the time of day. Nothing leaves this computer. On a mix, use “Less like this” or “Never in mixes” to steer it.</p>}
      </div>
    </>
  )
}

export function MixView({ id }: { id: string }) {
  const { mixes, reload } = useMixes()
  const mix = mixes?.find((m) => m.id === id)
  const tracks = useMixTracks(mix)
  const play = usePlayer((s) => s.playTracks)
  const steer = (t: LibraryTrack, pref: 'less' | 'never') =>
    api
      .setTrackPref(t.id, pref)
      .then(reload)
      .catch((e) => useStore.setState({ error: String(e) }))
  if (!mixes) return null
  if (!mix) return <p className="py-10 text-center text-ink-2">This mix isn’t available today.</p>
  return (
    <>
      <PageHeader
        art={<MixCover mix={mix} tracks={tracks} size={150} />}
        kicker={`Mix · ${tracks.length} tracks`}
        title={mix.title}
        sub={mix.reason}
        actions={
          tracks.length > 0 && (
            <RoundButton label="Play mix" kind="primary" size="lg" onClick={() => play(tracks, 0)}>
              <Play weight="fill" size={20} />
            </RoundButton>
          )
        }
      />
      <TrackTable
        tracks={tracks}
        empty="Nothing left in this mix."
        rowActions={(t) => (
          <>
            <RoundButton label={`Less like ${t.title}`} kind="plain" size="xs" onClick={() => steer(t, 'less')}>
              <ThumbsDown size={13} />
            </RoundButton>
            <RoundButton label={`Never put ${t.title} in mixes`} kind="plain" size="xs" onClick={() => steer(t, 'never')}>
              <Prohibit size={13} />
            </RoundButton>
          </>
        )}
      />
    </>
  )
}

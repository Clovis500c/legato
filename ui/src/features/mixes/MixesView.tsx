import { ArrowCounterClockwise, ArrowRight, Play, Prohibit, ThumbsDown } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type Mix } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton } from '../../shared/ui/controls'
import { Cover } from '../../shared/ui/Cover'
import { CoverGrid } from '../../shared/ui/CoverGrid'
import { PageHeader } from '../../shared/ui/PageHeader'
import { MediaCard } from '../../shared/ui/Section'
import { coverTracks } from '../library/covers'
import { musicOnly } from '../library/filter'
import { HiddenVideos } from '../library/HiddenVideos'
import { TrackTable } from '../library/TrackTable'
import { tracksMenu } from '../menus'
import { isRemote, remoteTrack, usePlayer } from '../player/store'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { useMixes } from './useMixes'
import { mixReason, mixTitle, weekdayName } from './words'
import { ask } from '../../shared/ui/Ask'

/** A mix's songs in order: library songs, songs new to you slotted at their place. */
export function mixSongs(mix: Mix, byId: Map<number, LibraryTrack>): LibraryTrack[] {
  const songs = mix.trackIds.flatMap((id) => byId.get(id) ?? [])
  for (const f of mix.found ?? []) songs.splice(f.at, 0, remoteTrack(f.track))
  return songs
}

function useMixTracks(mix?: Mix): LibraryTrack[] {
  const tracks = useStore((s) => s.tracks)
  return useMemo(() => (mix ? mixSongs(mix, new Map(tracks.map((t) => [t.id, t]))) : []), [tracks, mix])
}

/** Short label and big mark of a mix (template tile, badge on covers). */
function mixMark(mix: Mix): { label: string; mark: string } {
  const n = mix.id.match(/^daily-(\d)/)?.[1]
  if (n) return { label: tr('Daily'), mark: `0${n}` }
  const a = mix.id.match(/^artist-(\d)/)?.[1]
  if (a) return { label: tr('Artist'), mark: (mix.words?.name ?? mix.title.replace(/ Mix$/, '')).slice(0, 2).toUpperCase() }
  const marks: Record<string, { label: string; mark: string }> = {
    now: { label: tr('Now'), mark: '◐' },
    weekday: { label: tr('Today'), mark: mix.words?.day !== undefined ? weekdayName(mix.words.day, 'short').replace('.', '').slice(0, 3).toUpperCase() : '◐' },
    repeat: { label: tr('Repeat'), mark: '∞' },
    fresh: { label: tr('New'), mark: '+' },
    gems: { label: tr('Gems'), mark: '◇' },
    rediscover: { label: tr('Again'), mark: '↺' },
    supermix: { label: tr('Mix'), mark: '★' },
    discover: { label: tr('Discover'), mark: '✦' },
  }
  return marks[mix.id] ?? { label: tr('Mix'), mark: '♪' }
}

/** Flat tile, mono label: no artwork needed, no gradient. */
function MixTile({ mix, size }: { mix: Mix; size: number }) {
  const { label, mark } = mixMark(mix)
  return (
    <span className="relative grid shrink-0 place-items-center rounded-cover border border-line-soft bg-recess" style={{ width: size, height: size }}>
      <span className="absolute top-3 left-3 flex items-center gap-1.5 font-mono text-[0.625rem] tracking-[0.08em] text-ink-3 uppercase">
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
        <CoverGrid arts={songs.map(trackArt)} size={size - 2} framed={false} />
      ) : (
        <Cover title={mixTitle(mix)} art={trackArt(songs[0])} size={size} className="rounded-none! border-0!" />
      )}
      {/* Badge on the art: fixed dark chip, readable over any cover. */}
      <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[0.625rem] tracking-[0.08em] text-white uppercase">
        <span className="size-1.5 rounded-full bg-white" /> {label}
      </span>
    </span>
  )
}

export function MixCard({ mix }: { mix: Mix }) {
  const go = useStore((s) => s.go)
  const play = usePlayer((s) => s.playTracks)
  const tracks = useMixTracks(mix)
  const open = () => go({ name: 'mix', id: mix.id })
  return <MediaCard title={mixTitle(mix)} sub={mixReason(mix)} art={<MixCover mix={mix} tracks={tracks} size={176} />} onOpen={open} onPlay={() => play(tracks, 0)} menu={() => tracksMenu(tracks, ['-', { label: tr('Open'), icon: <ArrowRight size={16} />, onSelect: open }])} />
}

const SECTIONS: { kind: Mix['kind']; title: string }[] = [
  { kind: 'daily', title: msg('Your daily mixes') },
  { kind: 'moment', title: msg('For right now') },
  { kind: 'favorites', title: msg('Your favorites') },
  { kind: 'explore', title: msg('Explore your library') },
]

function ResetHistory({ onDone }: { onDone: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        if (!(await ask({ title: tr('Forget your listening history?'), body: tr('Your plays and “less / never” choices go; mixes start over. Your library stays as it is.'), ok: tr('Forget') }))) return
        await api.clearHistory().catch((e) => useStore.setState({ error: String(e) }))
        onDone()
      }}
    >
      <ArrowCounterClockwise size={14} /> {tr('Reset history')}
    </Button>
  )
}

export function MixesView() {
  const { mixes, reload } = useMixes()
  return (
    <>
      <PageHeader kicker={tr('For you · made on this PC from what you play')} title={tr('Mixes')} actions={<ResetHistory onDone={reload} />} />
      <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {mixes && mixes.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-ink-2">
            <p className="text-base text-ink">{tr('No mixes yet')}</p>
            <p>{tr('Play some music, or make a playlist: mixes appear after a few listens and change every day.')}</p>
          </div>
        )}
        <div className="flex flex-col gap-10">
          {SECTIONS.map(({ kind, title }) => {
            const list = mixes?.filter((m) => m.kind === kind) ?? []
            if (!list.length) return null
            return (
              <section key={kind} className="flex flex-col gap-3">
                <h2 className="text-[1.375rem] leading-7 font-bold">{tr(title)}</h2>
                {/* Cards' own padding is the gap (shared/ui/Section MediaCard). */}
                <ul className="stagger -mx-3 -mt-2 flex flex-wrap">
                  {list.map((m) => (
                    <MixCard key={m.id} mix={m} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
        {mixes && mixes.length > 0 && <p className="mt-8 max-w-160 text-xs text-ink-2">{tr('Built from your plays (full listens count more, skips count against), your playlists, your saves on YouTube Music and Spotify, what you play back to back and the time of day. To find new songs, a few of your favorites go to YouTube Music for their radio; your history stays on this computer. On a mix, use “Less like this” or “Never in mixes” to steer it.')}</p>}
      </div>
    </>
  )
}

export function MixView({ id }: { id: string }) {
  const { mixes, reload } = useMixes()
  const mix = mixes?.find((m) => m.id === id)
  // Mixes are built from music (crates/core mixes); one marked "not music" since waits in the fold.
  const all = useMixTracks(mix)
  const { kept: tracks, hidden } = useMemo(() => musicOnly(all), [all])
  const play = usePlayer((s) => s.playTracks)
  const steer = (t: LibraryTrack, pref: 'less' | 'never') =>
    api
      .setTrackPref(t.id, pref)
      .then(reload)
      .catch((e) => useStore.setState({ error: String(e) }))
  if (!mixes) return null
  if (!mix) return <p className="py-10 text-center text-ink-2">{tr('This mix isn’t available today.')}</p>
  return (
    <>
      <PageHeader
        art={<MixCover mix={mix} tracks={tracks} size={150} />}
        kicker={`${tr('Mix')} · ${trn(tracks.length, '{n} track', '{n} tracks')}`}
        title={mixTitle(mix)}
        sub={mixReason(mix)}
        actions={
          tracks.length > 0 && (
            <RoundButton label={tr('Play mix')} kind="primary" size="lg" onClick={() => play(tracks, 0)}>
              <Play weight="fill" size={20} />
            </RoundButton>
          )
        }
      />
      <HiddenVideos tracks={hidden} />
      <TrackTable
        tracks={tracks}
        empty={tr('Nothing left in this mix.')}
        rowActions={(t) =>
          // Songs new to you: not in the library, nothing to steer.
          !isRemote(t) && (
            <>
              <RoundButton label={tr('Less like {title}', { title: t.title })} kind="plain" size="xs" onClick={() => steer(t, 'less')}>
                <ThumbsDown size={13} />
              </RoundButton>
              <RoundButton label={tr('Never put {title} in mixes', { title: t.title })} kind="plain" size="xs" onClick={() => steer(t, 'never')}>
                <Prohibit size={13} />
              </RoundButton>
            </>
          )
        }
      />
    </>
  )
}

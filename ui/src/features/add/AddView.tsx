import { ArrowRight, Check, ClipboardText, FolderPlus, MagnifyingGlass, Play, Plus, QrCode } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../app/store'
import { api, type SearchHit, type SearchResults, type Source, type Track } from '../../shared/api'
import { formatDuration, region, spotifyList } from '../../shared/format'
import { Led, LedChip, RoundButton, Toggle } from '../../shared/ui/controls'
import { trackArt } from '../../shared/art'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { hitMenu, trackMenu } from '../menus'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { filterTracks } from '../library/filter'
import { remoteTrack, usePlayer } from '../player/store'
import { kindLabel, unofficial, videoKind } from './kind'
import { Detector } from './Detector'
import { AddToPlaylist } from '../library/AddToPlaylist'
import { HiddenFold } from '../library/HiddenVideos'
import { tr, trn } from '../../shared/i18n/i18n'

const order: Source[] = ['youtube', 'apple', 'spotify', 'local']

function Badge({ children }: { children: string }) {
  return <span className="rounded-[3px] border border-line px-1.5 font-mono text-[0.625rem] tracking-[0.08em] text-ink-3">{children}</span>
}

/** The catalog track of a hit (no UI fields). */
const trackOf = (h: SearchHit): Track => ({ title: h.title, artist: h.artist, album: h.album, durationMs: h.durationMs, isrc: h.isrc, ids: h.ids, art: h.art })

function HitRow({ hit, onAdded, onPlay, extra }: { hit: SearchHit; onAdded: (id: number) => void; onPlay: () => void; extra?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const kind = hit.ids.youtube && !hit.ids.apple ? videoKind(hit.title) : null
  const add = async () => {
    setBusy(true)
    try {
      onAdded(await api.addTrack(trackOf(hit)))
      await useStore.getState().refresh()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    // Double-click plays it, in the library or not.
    <li onContextMenu={onMenu(() => hitMenu(hit, add, busy, onPlay))} onDoubleClick={onPlay} className="group flex items-center gap-3.5 border-b border-line-soft px-2 py-2.5">
      <RoundButton label={tr('Play {title}', { title: hit.title })} kind="plain" size="sm" onClick={onPlay}>
        <Play size={14} weight="fill" />
      </RoundButton>
      <Cover title={hit.album ?? hit.title} art={trackArt({ ...hit, id: hit.libraryId ?? undefined })} size={42} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[0.8125rem] font-semibold">
          {hit.title} {kind && <Badge>{tr(kindLabel[kind])}</Badge>}
          {hit.musicness === 'notMusic' && <Badge>{tr('NOT MUSIC?')}</Badge>}
        </p>
        <p className="truncate text-xs text-ink-2">{[hit.artist, hit.album].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="flex items-center gap-2 text-ink-3">
        {order.filter((s) => hit.ids[s]).map((s) => (
          <SourceIcon key={s} source={s} size={13} />
        ))}
      </span>
      <span className="w-11 text-right font-mono text-[0.6875rem] text-ink-3">{formatDuration(hit.durationMs)}</span>
      {extra}
      {hit.libraryId ? (
        <RoundButton label={tr('Already in your library')} kind="ink" size="sm" disabled>
          <Check size={14} />
        </RoundButton>
      ) : (
        <RoundButton label={tr('Add {title}', { title: hit.title })} kind="soft" size="sm" disabled={busy} onClick={add}>
          <Plus size={14} />
        </RoundButton>
      )}
    </li>
  )
}

/** Shared playlist: link or QR text typed / pasted here (Ctrl+V anywhere works too). */
function ImportCode() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const digits = /^\d{3}\s?\d{3}$/.test(text.trim())
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        setBusy(true)
        try {
          // 6 digits = nearby sender; else link or QR text.
          useStore.setState({ incoming: digits ? await api.nearbyReceive(text) : text.trim() })
          setText('')
        } catch (err) {
          useStore.setState({ error: String(err) })
        } finally {
          setBusy(false)
        }
      }}
      className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3"
    >
      <p className="flex items-center gap-2 text-xs font-semibold">
        <QrCode size={16} className="text-ink-2" /> {tr('Import a shared playlist')}
      </p>
      <p className="text-xs text-ink-2">{busy ? tr('Looking for the sender on this network…') : tr('Paste a musicapp:// link, type a 6-digit code from a nearby Music App, or drop a QR screenshot on the window.')}</p>
      <span className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Link or 6-digit code')} aria-label={tr('Share link or code')} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 font-mono text-[0.6875rem] placeholder:text-ink-3" />
        <RoundButton label={tr('Import')} kind="ink" size="sm" type="submit" disabled={!text.trim() || busy}>
          <ArrowRight size={14} />
        </RoundButton>
      </span>
    </form>
  )
}

export function AddView() {
  const { tracks, go, status } = useStore()
  const play = usePlayer((s) => s.playTracks)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SearchResults>()
  const [busy, setBusy] = useState(false)
  const [only, setOnly] = useState<'all' | 'youtube' | 'apple'>('all')
  const [hideCovers, setHideCovers] = useState(true)
  const ytOn = status.youtube.connected
  const local = useMemo(() => (q.trim() ? filterTracks(tracks, q, 'all').slice(0, 4) : []), [tracks, q])
  const matching = (res?.hits ?? []).filter((h) => (only === 'all' || h.ids[only]) && !(hideCovers && h.ids.youtube && !h.ids.apple && unofficial(videoKind(h.title))))
  // Videos that clearly aren't music (talks, reactions, games): in their own fold under the results, folded again on
  // each search.
  const [round, setRound] = useState(0)
  const others = matching.filter((h) => h.musicness === 'notMusic')
  const hits = matching.filter((h) => h.musicness !== 'notMusic')
  // Results play as a queue, added or not (session-only items, like Home's recommendations). A hit with no YouTube
  // version gets one first (one search, nothing written) so it plays in full.
  const playHit = async (h: SearchHit, list = hits) => {
    const queue = list.map((x) => tracks.find((t) => t.id === x.libraryId) ?? remoteTrack(trackOf(x)))
    const i = list.indexOf(h)
    if (!h.libraryId && !h.ids.youtube) queue[i] = remoteTrack(await api.resolveTrack(trackOf(h)).catch(() => trackOf(h)))
    play(queue, i)
  }
  const markAdded = (i: number, libraryId: number) => setRes((r) => r && { ...r, hits: r.hits.map((h, j) => (j === i ? { ...h, libraryId } : h)) })

  // Music Detector's song: the matching catalog hit once the search for it is back (same ISRC or Apple id), else itself.
  const [found, setFound] = useState<SearchHit | null>(null)
  const identified = useMemo(() => {
    if (!found) return null
    const same = (h: SearchHit) => (found.isrc && h.isrc === found.isrc) || (found.ids.apple && h.ids.apple === found.ids.apple)
    const hit = res?.hits.find(same)
    return hit ? { ...hit, libraryId: hit.libraryId ?? found.libraryId } : found
  }, [found, res])
  const onFound = (t: Track) => {
    const inLibrary = tracks.find((x) => (t.isrc && x.isrc === t.isrc) || (t.ids.apple && x.ids.apple === t.ids.apple))
    setFound({ ...t, libraryId: inLibrary?.id ?? null, musicness: 'music' })
    const text = `${t.artist} ${t.title}`
    setQ(text)
    void run(text)
  }
  const playOne = async (h: SearchHit) => {
    const own = tracks.find((t) => t.id === h.libraryId)
    play([own ?? remoteTrack(h.ids.youtube ? trackOf(h) : await api.resolveTrack(trackOf(h)).catch(() => trackOf(h)))], 0)
  }
  // Library id of the identified song, added on the way when needed (Add to playlist).
  const identifiedIds = async () => {
    if (identified?.libraryId) return [identified.libraryId]
    const id = await api.addTrack(trackOf(identified!))
    setFound((f) => f && { ...f, libraryId: id })
    await useStore.getState().refresh()
    return [id]
  }

  const run = async (text: string) => {
    if (!text.trim()) return
    if (spotifyList(text)) return void useStore.getState().importSpotify(text.trim())
    setBusy(true)
    try {
      setRes(await api.searchCatalogs(text, region()))
      setRound((n) => n + 1)
    } catch (err) {
      useStore.setState({ error: String(err) })
    } finally {
      setBusy(false)
    }
  }
  const search = (e: React.FormEvent) => {
    e.preventDefault()
    setFound(null)
    void run(q)
  }
  // Top bar's "search everywhere" lands here.
  const request = useStore((s) => s.search)
  useEffect(() => {
    if (!request) return
    setFound(null)
    setQ(request.q)
    void run(request.q)
  }, [request?.n]) // once per ask

  return (
    <>
      <PageHeader kicker={tr('Add · YouTube, YouTube Music, Apple Music and your files')} title={tr('Add music')} />
      <form onSubmit={search} className="flex h-14 shrink-0 items-center gap-3 rounded-xl border border-line bg-raised pr-2 pl-4.5 shadow-[0_1px_2px_var(--shadow)] focus-within:border-ink-3">
        <MagnifyingGlass size={19} className="text-ink-2" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Title, artist, album, or a Spotify playlist link…')} aria-label={tr('Search catalogs')} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3" />
        <span className="flex items-center gap-3 rounded-full bg-recess px-3 py-1.5 font-mono text-[0.625rem] tracking-[0.08em] text-ink-2">
          {tr('SEARCHES')}
          <span className="flex items-center gap-1.5">
            <Led on /> AM
          </span>
          <span className="flex items-center gap-1.5">
            <Led on /> YT
          </span>
          <span className="flex items-center gap-1.5">
            <Led on={ytOn} /> YTM
          </span>
          <span className="flex items-center gap-1.5">
            <Led on /> {tr('LIB')}
          </span>
        </span>
        <RoundButton label={tr('Search')} kind="ink" type="submit" disabled={busy || !q.trim()}>
          <MagnifyingGlass size={15} />
        </RoundButton>
      </form>

      <div className="flex shrink-0 items-center justify-between gap-4 py-3.5">
        <div role="tablist" className="flex gap-2">
          <LedChip on={only === 'all'} label={tr('All')} count={res ? String(res.hits.length) : undefined} onClick={() => setOnly('all')} />
          <LedChip on={only === 'youtube'} label="YouTube" onClick={() => setOnly('youtube')} />
          <LedChip on={only === 'apple'} label="Apple Music" onClick={() => setOnly('apple')} />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          {tr('Hide covers and karaoke')} <Toggle label={tr('Hide covers and karaoke')} checked={hideCovers} onChange={setHideCovers} />
        </label>
      </div>

      <div className="flex min-h-0 flex-1 gap-8">
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {local.length > 0 && (
            <section className="mb-5">
              <h2 className="kicker pb-1.5">{tr('In your library')}</h2>
              <ul>
                {local.map((t, i) => (
                  <li key={t.id} onContextMenu={onMenu(() => trackMenu(t, { list: local, index: i }))}>
                    <button onDoubleClick={() => play(local, i)} onClick={() => play(local, i)} className="flex w-full items-center gap-3.5 border-b border-line-soft px-2 py-2 text-left hover:bg-raised">
                      <Cover title={t.album ?? t.title} art={trackArt(t)} size={34} />
                      <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{t.title}</span>
                      <span className="truncate text-xs text-ink-2">{t.artist}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {identified && (
            <section className="mb-5">
              <h2 className="kicker pb-1.5">{tr('Identified by AudD')}</h2>
              <ul>
                <HitRow
                  hit={identified}
                  onAdded={(id) => setFound((f) => f && { ...f, libraryId: id })}
                  onPlay={() => void playOne(identified)}
                  extra={<AddToPlaylist trackIds={identifiedIds} label={tr('Add {title} to a playlist', { title: identified.title })} />}
                />
              </ul>
            </section>
          )}
          {res && (
            <section>
              <h2 className="kicker pb-1.5">{tr('Catalogs')} · {trn(hits.length, '{n} result', '{n} results')}</h2>
              {res.errors.map((e) => (
                <p key={e} className="mb-2 text-xs text-danger">
                  {e}
                </p>
              ))}
              <ul>
                {hits.map((h) => (
                  <HitRow key={Object.values(h.ids).join('|')} hit={h} onAdded={(id) => markAdded(res.hits.indexOf(h), id)} onPlay={() => void playHit(h)} />
                ))}
              </ul>
              <HiddenFold key={round} count={others.length} className="mt-3">
                <ul>
                  {others.map((h) => (
                    <HitRow key={Object.values(h.ids).join('|')} hit={h} onAdded={(id) => markAdded(res.hits.indexOf(h), id)} onPlay={() => void playHit(h, others)} />
                  ))}
                </ul>
              </HiddenFold>
              {hits.length === 0 && !others.length && <p className="py-8 text-center text-ink-2">{tr('No results.')}</p>}
            </section>
          )}
          {!res && !local.length && <p className="py-10 text-center text-ink-2">{tr('Search for a track: it’s added to your library, with its YouTube version when one exists.')}</p>}
        </div>

        <aside className="scroll-quiet flex min-h-0 w-80 shrink-0 flex-col gap-4 overflow-y-auto pb-6">
          <Detector onFound={onFound} />
          <div className="rounded-xl border border-line px-4 py-2">
            <h2 className="kicker py-1.5">{tr('Search sources')}</h2>
            {[
              { code: 'YouTube', note: tr('Every video, no account needed'), on: true },
              { code: 'YouTube Music', note: ytOn ? tr('Songs, with your Google account') : tr('Sign in with Google (Accounts)'), on: ytOn },
              { code: 'Apple Music', note: tr('Public catalog, no account'), on: true },
              { code: 'Spotify', note: tr('Search closed without Premium'), on: false },
            ].map((s) => (
              <p key={s.code} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 text-[0.8125rem] first-of-type:border-0">
                <Led on={s.on} /> <span className="flex-1 font-medium">{s.code}</span>
                <span className="text-right text-[0.6875rem] text-ink-2">{s.note}</span>
              </p>
            ))}
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-line px-4 py-3">
            <ClipboardText size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <p className="text-xs text-ink-2">
              <span className="font-semibold text-ink">{tr('Paste a YouTube link')}</span> {tr('anywhere (Ctrl+V): the track is added right away.')}
            </p>
          </div>
          <ImportCode />
          <button onClick={() => go({ name: 'settings', section: 'sources' })} className="flex items-start gap-3 rounded-xl border border-dashed border-ink-4 px-4 py-3 text-left hover:bg-raised">
            <FolderPlus size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <span className="text-xs text-ink-2">
              <span className="font-semibold text-ink">{tr('Add a music folder')}</span>
              {tr(': your files play first.')}
            </span>
          </button>
        </aside>
      </div>
    </>
  )
}

import { ArrowRight, Check, ClipboardText, FolderPlus, MagnifyingGlass, Plus, QrCode } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type SearchHit, type SearchResults, type Source } from '../../shared/api'
import { formatDuration, region, spotifyList } from '../../shared/format'
import { Led, LedChip, RoundButton, Toggle } from '../../shared/ui/controls'
import { trackArt } from '../../shared/art'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Cover } from '../../shared/ui/Cover'
import { hitMenu, trackMenu } from '../menus'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SourceIcon } from '../../shared/ui/SourceIcon'
import { filterTracks } from '../library/filter'
import { usePlayer } from '../player/store'
import { kindLabel, unofficial, videoKind } from './kind'

const order: Source[] = ['youtube', 'apple', 'spotify', 'local']

function Badge({ children }: { children: string }) {
  return <span className="rounded-[3px] border border-line px-1.5 font-mono text-[9px] tracking-[0.08em] text-ink-3">{children}</span>
}

function HitRow({ hit, onAdded }: { hit: SearchHit; onAdded: (id: number) => void }) {
  const [busy, setBusy] = useState(false)
  const kind = hit.ids.youtube && !hit.ids.apple ? videoKind(hit.title) : null
  const add = async () => {
    setBusy(true)
    try {
      onAdded(await api.addTrack({ title: hit.title, artist: hit.artist, album: hit.album, durationMs: hit.durationMs, isrc: hit.isrc, ids: hit.ids, art: hit.art }))
      await useStore.getState().refresh()
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <li onContextMenu={onMenu(() => hitMenu(hit, add, busy))} className="flex items-center gap-3.5 border-b border-line-soft px-2 py-2.5">
      <Cover title={hit.album ?? hit.title} art={trackArt({ ...hit, id: hit.libraryId ?? undefined })} size={42} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13px] font-semibold">
          {hit.title} {kind && <Badge>{kindLabel[kind]}</Badge>}
          {hit.musicness === 'notMusic' && <Badge>NOT MUSIC?</Badge>}
        </p>
        <p className="truncate text-xs text-ink-2">{[hit.artist, hit.album].filter(Boolean).join(' · ')}</p>
      </div>
      <span className="flex items-center gap-2 text-ink-3">
        {order.filter((s) => hit.ids[s]).map((s) => (
          <SourceIcon key={s} source={s} size={13} />
        ))}
      </span>
      <span className="w-11 text-right font-mono text-[11px] text-ink-3">{formatDuration(hit.durationMs)}</span>
      {hit.libraryId ? (
        <RoundButton label="Already in your library" kind="ink" size="sm" disabled>
          <Check size={14} />
        </RoundButton>
      ) : (
        <RoundButton label={`Add ${hit.title}`} kind="soft" size="sm" disabled={busy} onClick={add}>
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
        <QrCode size={16} className="text-ink-2" /> Import a shared playlist
      </p>
      <p className="text-xs text-ink-2">{busy ? 'Looking for the sender on this network…' : 'Paste a musicapp:// link, type a 6-digit code from a nearby Music App, or drop a QR screenshot on the window.'}</p>
      <span className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Link or 6-digit code" aria-label="Share link or code" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 font-mono text-[11px] placeholder:text-ink-3" />
        <RoundButton label="Import" kind="ink" size="sm" type="submit" disabled={!text.trim() || busy}>
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
  // Videos that clearly aren't music (talks, reactions, games): hidden until asked, per search.
  const [showOthers, setShowOthers] = useState(false)
  const ytOn = status.youtube.connected
  const local = useMemo(() => (q.trim() ? filterTracks(tracks, q, 'all').slice(0, 4) : []), [tracks, q])
  const matching = (res?.hits ?? []).filter((h) => (only === 'all' || h.ids[only]) && !(hideCovers && h.ids.youtube && !h.ids.apple && unofficial(videoKind(h.title))))
  const others = matching.filter((h) => h.musicness === 'notMusic').length
  const hits = showOthers ? matching : matching.filter((h) => h.musicness !== 'notMusic')
  const markAdded = (i: number, libraryId: number) => setRes((r) => r && { ...r, hits: r.hits.map((h, j) => (j === i ? { ...h, libraryId } : h)) })

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    if (spotifyList(q)) return void useStore.getState().importSpotify(q.trim())
    setBusy(true)
    try {
      setRes(await api.searchCatalogs(q, region()))
      setShowOthers(false)
    } catch (err) {
      useStore.setState({ error: String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader kicker="Add · YouTube, YouTube Music, Apple Music and your files" title="Add music" />
      <form onSubmit={search} className="flex h-14 shrink-0 items-center gap-3 rounded-xl border border-line bg-raised pr-2 pl-4.5 shadow-[0_1px_2px_var(--shadow)] focus-within:border-ink-3">
        <MagnifyingGlass size={19} className="text-ink-2" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, artist, album, or a Spotify playlist link…" aria-label="Search catalogs" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3" />
        <span className="flex items-center gap-3 rounded-full bg-recess px-3 py-1.5 font-mono text-[9px] tracking-[0.08em] text-ink-2">
          SEARCHES
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
            <Led on /> LIB
          </span>
        </span>
        <RoundButton label="Search" kind="ink" type="submit" disabled={busy || !q.trim()}>
          <MagnifyingGlass size={15} />
        </RoundButton>
      </form>

      <div className="flex shrink-0 items-center justify-between gap-4 py-3.5">
        <div role="tablist" className="flex gap-2">
          <LedChip on={only === 'all'} label="All" count={res ? String(res.hits.length) : undefined} onClick={() => setOnly('all')} />
          <LedChip on={only === 'youtube'} label="YouTube" onClick={() => setOnly('youtube')} />
          <LedChip on={only === 'apple'} label="Apple Music" onClick={() => setOnly('apple')} />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Hide covers and karaoke <Toggle label="Hide covers and karaoke" checked={hideCovers} onChange={setHideCovers} />
        </label>
      </div>

      <div className="flex min-h-0 flex-1 gap-8">
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 pb-6">
          {local.length > 0 && (
            <section className="mb-5">
              <h2 className="kicker pb-1.5">In your library</h2>
              <ul>
                {local.map((t, i) => (
                  <li key={t.id} onContextMenu={onMenu(() => trackMenu(t, { list: local, index: i }))}>
                    <button onDoubleClick={() => play(local, i)} onClick={() => play(local, i)} className="flex w-full items-center gap-3.5 border-b border-line-soft px-2 py-2 text-left hover:bg-raised">
                      <Cover title={t.album ?? t.title} art={trackArt(t)} size={34} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.title}</span>
                      <span className="truncate text-xs text-ink-2">{t.artist}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {res && (
            <section>
              <h2 className="kicker pb-1.5">Catalogs · {hits.length} results</h2>
              {res.errors.map((e) => (
                <p key={e} className="mb-2 text-xs text-danger">
                  {e}
                </p>
              ))}
              <ul>
                {hits.map((h) => (
                  <HitRow key={Object.values(h.ids).join('|')} hit={h} onAdded={(id) => markAdded(res.hits.indexOf(h), id)} />
                ))}
              </ul>
              {others > 0 && (
                <p className="flex items-center justify-between gap-3 border-b border-line-soft px-2 py-3 text-xs text-ink-2">
                  {showOthers ? `Showing ${others} video${others === 1 ? '' : 's'} that don’t look like music` : `${others} video${others === 1 ? '' : 's'} hidden because they aren’t music`}
                  <button onClick={() => setShowOthers(!showOthers)} className="rounded-full border border-line px-3 py-1 font-medium text-ink hover:bg-raised">
                    {showOthers ? 'Hide them' : 'Show'}
                  </button>
                </p>
              )}
              {hits.length === 0 && !others && <p className="py-8 text-center text-ink-2">No results.</p>}
            </section>
          )}
          {!res && !local.length && <p className="py-10 text-center text-ink-2">Search for a track: it’s added to your library, with its YouTube version when one exists.</p>}
        </div>

        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <div className="rounded-xl border border-line px-4 py-2">
            <h2 className="kicker py-1.5">Search sources</h2>
            {[
              { code: 'YouTube', note: 'Every video, no account needed', on: true },
              { code: 'YouTube Music', note: ytOn ? 'Songs, with your Google account' : 'Sign in with Google (Accounts)', on: ytOn },
              { code: 'Apple Music', note: 'Public catalog, no account', on: true },
              { code: 'Spotify', note: 'Search closed without Premium', on: false },
            ].map((s) => (
              <p key={s.code} className="flex items-center gap-2.5 border-t border-line-soft py-2.5 text-[13px] first-of-type:border-0">
                <Led on={s.on} /> <span className="flex-1 font-medium">{s.code}</span>
                <span className="text-right text-[11px] text-ink-2">{s.note}</span>
              </p>
            ))}
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-line px-4 py-3">
            <ClipboardText size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <p className="text-xs text-ink-2">
              <span className="font-semibold text-ink">Paste a YouTube link</span> anywhere (Ctrl+V): the track is added right away.
            </p>
          </div>
          <ImportCode />
          <button onClick={() => go({ name: 'settings', section: 'sources' })} className="flex items-start gap-3 rounded-xl border border-dashed border-ink-4 px-4 py-3 text-left hover:bg-raised">
            <FolderPlus size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <span className="text-xs text-ink-2">
              <span className="font-semibold text-ink">Add a music folder</span>: your files play first.
            </span>
          </button>
        </aside>
      </div>
    </>
  )
}

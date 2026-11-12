'use client'

import { useEffect, useState } from 'react'
import { Logo } from './Logo'
import { codeOf, fromFragment, hueOf, summary, type Item, type Shared } from './sharelink'

const time = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

/** Where a song can be heard without the app: its YouTube video, its Apple Music page, or a YouTube search by name. */
function listen(i: Item): [string, string] {
  if (i.kind === 'youtube') return ['Listen on YouTube', `https://www.youtube.com/watch?v=${i.id}`]
  if (i.kind === 'apple') return ['Open in Apple Music', `https://music.apple.com/song/${i.id}`]
  return ['Find on YouTube', `https://www.youtube.com/results?search_query=${encodeURIComponent(`${i.artist} ${i.title}`)}`]
}

const button = 'rounded-full px-4 py-2 text-sm font-semibold'

/**
 * A playlist shared from Legato (Share › Copy link), read from the address's fragment by this page's own script:
 * a browser never sends a fragment, so no server sees the playlist. English only (a recipient's page, one screen).
 * No covers: they would load from YouTube's image host. "Open in Legato" is a `legato://` link, which the installed app
 * registers with Windows (src-tauri protocol.rs); on a PC without it the link does nothing, so "Copy the link for
 * Legato" stays beside it.
 */
export function SharedPlaylist() {
  const [list, setList] = useState<Shared | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const read = () => fromFragment(location.hash).then((s) => (setList(s), setError('')), (e) => (setList(null), setError(String(e.message ?? e))))
    void read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  const facts = list ? summary(list) : { songs: 0, minutes: 0, youtube: 0, apple: 0 }
  const copy = () =>
    navigator.clipboard.writeText(`legato://playlist/${codeOf(location.hash)}`).then(
      () => setCopied(true),
      () => {},
    )
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-5 py-10">
      <a href="../" className="flex w-fit items-center gap-2.5 text-lg font-black">
        <Logo className="size-8" /> Legato
      </a>
      {error && (
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black tracking-tight">No playlist here</h1>
          <p className="text-ink-2">{error}. Ask for the link again: it must be copied whole.</p>
        </div>
      )}
      {list && (
        <>
          <header className="flex flex-col gap-3 rounded-2xl p-6 text-white" style={{ background: `linear-gradient(135deg, hsl(${hueOf(list.name)} 55% 40%), hsl(${(hueOf(list.name) + 50) % 360} 60% 20%))` }}>
            <p className="text-sm opacity-80">A playlist shared with Legato</p>
            <h1 className="text-4xl font-black tracking-tight break-words">{list.name || 'Playlist'}</h1>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm opacity-90">
              <span>{list.items.length === 1 ? '1 song' : `${list.items.length.toLocaleString('en')} songs`}</span>
              {facts.minutes > 0 && <span>· {facts.minutes >= 60 ? `${Math.floor(facts.minutes / 60)} h ${facts.minutes % 60} min` : `${facts.minutes} min`}</span>}
              {facts.youtube > 0 && <span>· {facts.youtube.toLocaleString('en')} on YouTube</span>}
              {facts.apple > 0 && <span>· {facts.apple.toLocaleString('en')} on Apple Music</span>}
            </p>
          </header>
          <div className="flex flex-wrap items-center gap-3">
            <a href={`legato://playlist/${codeOf(location.hash)}`} className={`${button} bg-ink text-on-ink`}>
              Open in Legato
            </a>
            <button type="button" onClick={copy} className={`${button} border border-line`}>
              {copied ? 'Copied: paste it in Legato (Ctrl+V)' : 'Copy the link for Legato'}
            </button>
            <a href="../" className={`${button} border border-line`}>
              Get Legato
            </a>
          </div>
          <ol className="flex flex-col">
            {list.items.map((i, n) => {
              const [label, href] = listen(i)
              return (
                <li key={n} className="flex items-center gap-4 border-t border-line-soft py-3">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg text-sm font-bold text-white tabular-nums" style={{ background: `hsl(${(hueOf(list.name) + n * 7) % 360} 45% 38%)` }}>
                    {n + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.kind === 'apple' ? 'A song on Apple Music' : i.title || 'A video on YouTube'}</span>
                    {i.kind !== 'apple' && i.artist && <span className="block truncate text-sm text-ink-2">{i.artist}</span>}
                  </span>
                  {i.kind === 'youtube' && i.secs > 0 && <span className="shrink-0 text-sm text-ink-3 tabular-nums">{time(i.secs)}</span>}
                  <a href={href} target="_blank" rel="noreferrer noopener" className="shrink-0 text-sm font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                    {label}
                  </a>
                </li>
              )
            })}
          </ol>
        </>
      )}
      <p className="mt-auto text-xs text-ink-3">
        This page read the playlist from the link itself, in your browser: nothing was sent to a server, and nothing loads from another site until you follow a link.
        Legato is a free music player for Windows and Android that plays YouTube, Spotify, Apple Music playlists and your own files in one place.
      </p>
    </main>
  )
}

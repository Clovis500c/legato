import { ArrowSquareOut } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { api, type Bio } from '../../shared/api'
import { artistName } from '../../shared/artistName'
import { msg, tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Section } from '../../shared/ui/Section'
import { type Found, linksFor } from './linksFor'

/** What a link is, in words: MusicBrainz's relation names. */
const LABEL: Record<string, string> = { 'official homepage': msg('Official website'), wikipedia: 'Wikipedia', bandcamp: 'Bandcamp', discogs: 'Discogs', allmusic: 'AllMusic', 'social network': msg('Social network'), streaming: msg('Streaming'), youtube: 'YouTube' }
export const linkLabel = (kind: string) => LABEL[kind] ?? kind

/**
 * Links out of an artist's page, from MusicBrainz: asked only when the button is pressed (the artist's name goes to
 * musicbrainz.org, in two requests, a second apart), opened in the browser.
 */
export function ArtistLinks({ artist }: { artist: string }) {
  const [found, setFound] = useState<Found | null>(null)
  // The artist being looked up: an answer lands with its own artist, never on the page moved to since.
  const [asking, setAsking] = useState<string | null>(null)
  // A bio lands with its artist too.
  const [bioOf, setBioOf] = useState<{ artist: string; bio: Bio } | null>(null)
  const links = linksFor(found, artist)
  const wiki = links?.find((l) => l.kind === 'wikipedia')
  const bio = bioOf?.artist === artist ? bioOf.bio : null
  const busy = asking === artist
  const find = () => {
    const asked = artist
    setAsking(asked)
    api
      .artistLinks(asked)
      .then((l) => setFound({ artist: asked, links: l }), (e) => useStore.getState().notify(String(e), { kind: 'error' }))
      .finally(() => setAsking((a) => (a === asked ? null : a)))
  }
  const readBio = () => {
    if (!wiki) return
    const asked = artist
    setAsking(asked)
    api
      .artistBio(wiki.url)
      .then((b) => setBioOf({ artist: asked, bio: b }), (e) => useStore.getState().notify(String(e), { kind: 'error' }))
      .finally(() => setAsking((a) => (a === asked ? null : a)))
  }
  return (
    <Section title={tr('Links')}>
      {links === null ? (
        <Button variant="ghost" disabled={busy} onClick={find} className="self-start">
          {busy ? tr('Looking…') : tr('Find links on MusicBrainz')}
        </Button>
      ) : links.length === 0 ? (
        <p className="text-sm text-ink-2">{tr('MusicBrainz has no links for {artist}.', { artist: artistName(artist) })}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {links.map((l) => (
            <li key={l.url}>
              <Button variant="ghost" onClick={() => void openUrl(l.url).catch((e) => useStore.getState().notify(String(e), { kind: 'error' }))} title={l.url}>
                {tr(linkLabel(l.kind))} <ArrowSquareOut size={14} />
              </Button>
            </li>
          ))}
          {wiki && !bio && (
            <li>
              <Button variant="ghost" disabled={busy} onClick={readBio}>
                {busy ? tr('Looking…') : tr('Short bio')}
              </Button>
            </li>
          )}
        </ul>
      )}
      {bio && (
        <div className="mt-3 max-w-2xl text-sm text-ink-2">
          <p>{bio.text}</p>
          <button type="button" onClick={() => void openUrl(bio.page).catch(() => {})} className="mt-1 text-xs underline-offset-2 hover:underline">
            {tr('From Wikipedia, under CC BY-SA')}
          </button>
        </div>
      )}
    </Section>
  )
}

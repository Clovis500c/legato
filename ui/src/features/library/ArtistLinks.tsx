import { ArrowSquareOut } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { api, type ArtistLink } from '../../shared/api'
import { artistName } from '../../shared/artistName'
import { msg, tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Section } from '../../shared/ui/Section'

/** What a link is, in words: MusicBrainz's relation names. */
const LABEL: Record<string, string> = { 'official homepage': msg('Official website'), wikipedia: 'Wikipedia', bandcamp: 'Bandcamp', discogs: 'Discogs', allmusic: 'AllMusic', 'social network': msg('Social network'), streaming: msg('Streaming'), youtube: 'YouTube' }
export const linkLabel = (kind: string) => LABEL[kind] ?? kind

/**
 * Links out of an artist's page, from MusicBrainz: asked only when the button is pressed (the artist's name goes to
 * musicbrainz.org, in two requests, a second apart), opened in the browser.
 */
export function ArtistLinks({ artist }: { artist: string }) {
  const [links, setLinks] = useState<ArtistLink[] | null>(null)
  const [busy, setBusy] = useState(false)
  const find = () => {
    setBusy(true)
    api
      .artistLinks(artist)
      .then(setLinks, (e) => useStore.getState().notify(String(e), { kind: 'error' }))
      .finally(() => setBusy(false))
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
        </ul>
      )}
    </Section>
  )
}

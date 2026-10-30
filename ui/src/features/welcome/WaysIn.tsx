import { ArrowRight, GoogleLogo, LinkSimple, MagnifyingGlass, YoutubeLogo } from '@phosphor-icons/react'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Led, RoundButton } from '../../shared/ui/controls'
import { AddFolder, FIELD } from '../add/AddView'
import { Card } from '../add/Card'
import { useGoogleAccounts } from '../sources/google'
import { linkKind } from './firstRun'

/** YouTube Music: Google's own sign-in page, then the playlists come in on their own. */
function GoogleCard() {
  const { data, waiting, signIn } = useGoogleAccounts()
  const busy = useStore((s) => s.busy)
  return (
    <Card icon={YoutubeLogo} title="YouTube Music" sub={tr('Sign in with Google to import your YouTube Music playlists and Liked Music. No keys.')}>
      {data?.signedIn ? (
        <p className="mt-auto flex items-center gap-2 text-xs text-ink-2">
          <Led on /> {busy ? tr('Importing…') : tr('Connected')}
        </p>
      ) : (
        <Button onClick={() => signIn(false)} className="mt-auto self-start">
          <GoogleLogo size={14} weight="bold" /> {waiting ? tr('Waiting for Google…') : tr('Sign in with Google')}
        </Button>
      )}
    </Card>
  )
}

/** A public Spotify playlist or album (imported whole, played from YouTube), or a YouTube song. */
function LinkCard({ onLeave }: { onLeave?: () => void }) {
  const [text, setText] = useState('')
  const link = text.trim()
  const kind = linkKind(link)
  return (
    <Card icon={LinkSimple} title={tr('Paste a link')} sub={tr('A public Spotify playlist or album comes in whole; a YouTube link adds its song.')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!kind) return
          onLeave?.()
          const { importSpotify, addLink } = useStore.getState()
          void (kind === 'spotify' ? importSpotify(link) : addLink(link))
        }}
        className="mt-auto flex gap-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Spotify or YouTube link')} aria-label={tr('Paste a link')} spellCheck={false} className={`${FIELD} flex-1`} />
        <RoundButton label={tr('Import')} kind="ink" size="sm" type="submit" disabled={!kind}>
          <ArrowRight size={14} />
        </RoundButton>
      </form>
    </Card>
  )
}

/** YouTube, YouTube Music and Apple Music at once: the results page, a song plays in one click. */
function SearchCard({ onLeave }: { onLeave?: () => void }) {
  const [q, setQ] = useState('')
  return (
    <Card icon={MagnifyingGlass} title={tr('Search and play')} sub={tr('YouTube, YouTube Music and Apple Music, no account needed.')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!q.trim()) return
          onLeave?.()
          useStore.getState().searchFor(q.trim())
        }}
        className="mt-auto flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Song, artist or album')} aria-label={tr('Search')} className={`${FIELD} flex-1`} />
        <RoundButton label={tr('Search')} kind="ink" size="sm" type="submit" disabled={!q.trim()}>
          <ArrowRight size={14} />
        </RoundButton>
      </form>
    </Card>
  )
}

/**
 * The ways music comes in, as cards (Add music has them all): the welcome, and Home while the library is empty.
 * onLeave: a card is about to open another page (the welcome closes first).
 */
export function WaysIn({ onLeave }: { onLeave?: () => void }) {
  return (
    <div className="stagger grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
      <AddFolder />
      <GoogleCard />
      <LinkCard onLeave={onLeave} />
      <SearchCard onLeave={onLeave} />
    </div>
  )
}

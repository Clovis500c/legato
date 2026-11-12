import { useEffect, useState } from 'react'
import { api, type LibraryTrack, type SongCredit } from '../../shared/api'
import { artistName } from '../../shared/artistName'
import { msg, tr } from '../../shared/i18n/i18n'
import { Dialog } from '../../shared/ui/Dialog'

/** Roles MusicBrainz names, in words (an instrument or a voice keeps its own name as MusicBrainz writes it). */
const ROLE: Record<string, string> = { producer: msg('Producer'), composer: msg('Composer'), lyricist: msg('Lyrics'), writer: msg('Writer'), arranger: msg('Arranger'), mix: msg('Mix'), engineer: msg('Engineer'), mastering: msg('Mastering'), conductor: msg('Conductor'), performer: msg('Performer') }
export const roleLabel = (role: string) => (ROLE[role] ? tr(ROLE[role]) : role)

/** The people by role: each role once, its people together, in the order they came. */
export function byRole(credits: SongCredit[]): [string, string[]][] {
  const out = new Map<string, string[]>()
  for (const c of credits) out.set(c.role, [...(out.get(c.role) ?? []), c.name])
  return [...out]
}

/**
 * Right-click › Credits…: who wrote, produced and played on the song, from MusicBrainz. Opening it is the click: the
 * title and artist go to musicbrainz.org (two requests, a second apart), nothing else.
 */
export function CreditsDialog({ track, onClose }: { track: LibraryTrack; onClose: () => void }) {
  const [credits, setCredits] = useState<SongCredit[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    api.songCredits(track.title, track.artist, track.durationMs).then(
      (c) => live && setCredits(c),
      (e) => live && setError(String(e)),
    )
    return () => {
      live = false
    }
  }, [track])
  return (
    <Dialog title={tr('Credits')} kicker={`${track.title} · ${artistName(track.artist)}`} onClose={onClose}>
      {error ? (
        <p className="text-sm text-ink-2">{error}</p>
      ) : credits === null ? (
        <p className="text-sm text-ink-2">{tr('Looking…')}</p>
      ) : credits.length === 0 ? (
        <p className="text-sm text-ink-2">{tr('MusicBrainz has no credits for this song.')}</p>
      ) : (
        <dl className="flex flex-col gap-2 text-sm">
          {byRole(credits).map(([role, names]) => (
            <div key={role} className="flex gap-3">
              <dt className="w-28 shrink-0 text-ink-3">{roleLabel(role)}</dt>
              <dd className="min-w-0 flex-1">{names.join(', ')}</dd>
            </div>
          ))}
        </dl>
      )}
    </Dialog>
  )
}

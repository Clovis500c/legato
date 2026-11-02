import type { Contact, Via, Why } from '../../shared/api'
import { msg, trn } from '../../shared/i18n/i18n'

/** Why a host was asked, said on screen through tr (brands as they are). */
export const WHY_LABELS: Record<Why, string> = {
  youTube: 'YouTube',
  googleSignIn: msg('Google sign-in'),
  spotify: 'Spotify',
  connectSpotify: msg('Connect Spotify'),
  appleMusic: 'Apple Music',
  deezer: 'Deezer',
  soundCloud: 'SoundCloud',
  covers: msg('Covers'),
  lyrics: msg('Lyrics'),
  skipParts: msg('Skip non-music parts'),
  scrobbling: msg('Scrobbling'),
  detector: msg('Music Detector'),
  updates: msg('Updates'),
  adLists: msg('Ad and tracker lists'),
  plugin: msg('Plugins'),
  other: msg('Other'),
}

/** Who asked: Settings › Privacy's groups, in this order. */
export const VIA_LABELS: Record<Via, string> = { app: msg('The app'), window: msg('App windows'), plugin: msg('Plugins') }

/** Today's contacts by who asked, each most asked first; empty groups left out. */
export function byVia(contacts: Contact[]): { via: Via; rows: Contact[] }[] {
  return (Object.keys(VIA_LABELS) as Via[])
    .map((via) => ({ via, rows: contacts.filter((c) => c.via === via).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)) }))
    .filter((g) => g.rows.length)
}

/** The app's count is connections (one carries many requests); a window's or a plugin's, requests. */
export const countText = (c: Contact) => (c.via === 'app' ? trn(c.count, '{n} connection', '{n} connections') : trn(c.count, '{n} request', '{n} requests'))

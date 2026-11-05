import type { LibraryTrack } from '../../shared/api'
import { artistName } from '../../shared/artistName'
import { formatCount } from '../../shared/format'
import { locale, msg, tr, trn } from '../../shared/i18n/i18n'
import type { Personality, Recap, RecapSpan } from './recap'
import { hours } from './stats'

/** One card of a recap: drawn on screen and as a picture alike (`recapDraw.ts`). */
export interface RecapCard {
  /** Key and the picture's file name. */
  id: string
  kicker: string
  title: string
  sub?: string
  cover?: LibraryTrack
  rows?: { track?: LibraryTrack; title: string; sub?: string }[]
  /** Numbers drawn big, each over its label. */
  figures?: { value: string; label: string }[]
}

/** "2026", "October 2026". */
export const spanLabel = (s: RecapSpan) => (s.month === null ? String(s.year) : new Date(s.year, s.month, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }))

/** Each personality: its name, and why (the share behind it). */
const PERSONALITY: Record<Personality, [string, string]> = {
  onRepeat: [msg('On repeat'), msg('{title} was {share} of your listens')],
  loyal: [msg('Loyal'), msg('{artist} was {share} of your listening time')],
  explorer: [msg('Explorer'), msg('{share} of your artists were new to you')],
  nightOwl: [msg('Night owl'), msg('{share} of your music late at night')],
  earlyBird: [msg('Early bird'), msg('{share} of your music early in the morning')],
  eclectic: [msg('Eclectic'), msg('{n} artists, none above {share} of your time')],
}

/** A recap's cards, in their order: time, top artist, top songs, top album, a song a month (a year), habits, personality. */
export function recapCards(r: Recap): RecapCard[] {
  const s = r.stats
  const pct = (x: number) => new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(x)
  const [artist, ...artists] = s.topArtists
  const [song, ...songs] = s.topSongs
  const album = s.topAlbums[0]
  const cards: RecapCard[] = [
    {
      id: 'time',
      kicker: tr('Your {span} in music', { span: spanLabel(r.span) }),
      title: tr('{time} of music', { time: hours(s.ms) }),
      sub: [trn(s.listens, '{n} listen', '{n} listens'), trn(s.songs, '{n} song', '{n} songs'), trn(s.artists, '{n} artist', '{n} artists')].join(' · '),
    },
  ]
  if (artist) {
    const rows = artists.slice(0, 4).map((a, i) => ({ track: a.item.cover, title: `${i + 2}. ${artistName(a.item.name)}`, sub: hours(a.ms) }))
    cards.push({ id: 'artist', kicker: tr('Your top artist'), title: artistName(artist.item.name), sub: tr('{time} together', { time: hours(artist.ms) }), cover: artist.item.cover, rows })
  }
  if (song) {
    const rows = songs.slice(0, 4).map((x, i) => ({ track: x.item, title: `${i + 2}. ${x.item.title}`, sub: artistName(x.item.artist) }))
    cards.push({ id: 'songs', kicker: tr('Your top songs'), title: song.item.title, sub: `${artistName(song.item.artist)} · ${trn(song.listens, '{n} listen', '{n} listens')}`, cover: song.item, rows })
  }
  if (album) cards.push({ id: 'album', kicker: tr('Your top album'), title: album.item.album, sub: `${artistName(album.item.artist)} · ${hours(album.ms)}`, cover: album.item.cover })
  const months = r.months.flatMap((m, month) => (m ? [{ track: m.item, title: m.item.title, sub: new Date(r.span.year, month, 1).toLocaleDateString(locale(), { month: 'long' }) }] : []))
  if (months.length >= 2) cards.push({ id: 'months', kicker: tr('A song for each month'), title: spanLabel(r.span), rows: months })
  cards.push({
    id: 'habits',
    kicker: tr('How you listened'),
    // "12 AM" on one line.
    title: tr('Mostly around {hour}', { hour: new Date(2026, 0, 1, r.topHour).toLocaleTimeString(locale(), { hour: 'numeric' }).replace(/ /g, ' ') }),
    figures: [
      { value: formatCount(s.bestStreak), label: tr('Days in a row') },
      { value: formatCount(s.newArtists), label: tr('New artists') },
    ],
  })
  const [name, why] = PERSONALITY[r.personality]
  const vars = { share: pct(r.share), title: song ? tr('“{title}”', { title: song.item.title }) : '', artist: artist ? artistName(artist.item.name) : '', n: formatCount(s.artists) }
  cards.push({ id: 'personality', kicker: tr('Your listening personality'), title: tr(name), sub: tr(why, vars) })
  return cards
}

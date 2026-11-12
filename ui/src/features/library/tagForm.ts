import type { FileTags, LibraryTrack, SongRelease, SongTags } from '../../shared/api'

/** Edit song info's fields, in the order shown. Title for one song only; several songs can be numbered instead. */
export const TAG_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'genre', 'year', 'bpm', 'key', 'track', 'disc'] as const
export type TagField = (typeof TAG_FIELDS)[number]
/** What the fields hold, as typed (numbers too). */
export type TagForm = Record<TagField, string>
/** Where a field starts: the value every song shares ('' = none has one), or null = several values. */
export type TagStart = Record<TagField, string | null>

const NUMBERS = ['year', 'bpm', 'track', 'disc'] as const

/** Where the form starts: what the files say, the library's title, artist and album where a file says nothing. */
export function startOf(tracks: LibraryTrack[], files: FileTags[]): TagStart {
  const songs = tracks.map((t, i) => ({ ...files[i], title: files[i]?.title ?? t.title, artist: files[i]?.artist ?? t.artist, album: files[i]?.album ?? t.album }))
  const start = {} as TagStart
  for (const f of TAG_FIELDS) {
    const values = new Set(songs.map((s) => String(s[f] ?? '')))
    start[f] = values.size > 1 ? null : ([...values][0] ?? '')
  }
  return start
}

/** The fields as they start: several values show empty. */
export const formOf = (start: TagStart): TagForm => Object.fromEntries(TAG_FIELDS.map((f) => [f, start[f] ?? ''])) as TagForm

/** A number field holds 0 to 9999, or nothing (taken off). */
export const numberOk = (text: string) => /^\d{0,4}$/.test(text.trim())

/**
 * What to write: the fields changed from where they started (one song: its title and artist always, as shown), text
 * trimmed, emptied text and numbers taking a field off. A field with several values left empty stays as each file has
 * it. `number`: the songs numbered in their order, the track field aside.
 */
export function tagsToWrite(form: TagForm, start: TagStart, { one, number }: { one: boolean; number: boolean }): Omit<SongTags, 'coverPath' | 'removeCover'> {
  const changed = (f: TagField) => form[f].trim() !== (start[f] ?? '')
  const text = (f: TagField) => (changed(f) ? form[f].trim() : null)
  const count = (f: TagField) => (changed(f) ? Number(form[f].trim() || 0) : null)
  return {
    title: one ? form.title.trim() : null,
    artist: one ? form.artist.trim() : text('artist'),
    album: text('album'),
    albumArtist: text('albumArtist'),
    genre: text('genre'),
    year: count('year'),
    bpm: count('bpm'),
    key: text('key'),
    track: number ? null : count('track'),
    disc: count('disc'),
    number,
  }
}

/** Save is possible: no title or artist emptied, numbers 0 to 9999. */
export function canSave(form: TagForm, start: TagStart, one: boolean): boolean {
  const out = tagsToWrite(form, start, { one, number: false })
  return out.title !== '' && out.artist !== '' && NUMBERS.every((f) => numberOk(form[f]))
}

/** A MusicBrainz release picked in Edit song info: its album, album artist, year and numbers in the form, the rest kept. */
export function withRelease(form: TagForm, r: SongRelease): TagForm {
  const n = (v: number | null) => (v === null || v > 9999 ? undefined : String(v))
  const set = { album: r.album || undefined, albumArtist: r.albumArtist || undefined, year: n(r.year), track: n(r.track), disc: n(r.disc) }
  return { ...form, ...Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined)) }
}

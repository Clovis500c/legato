// What a drop on the window is, by file type: Legato's own files first (a remix, a backup, a theme, a song list), music
// and folders otherwise. Only the extension decides here; each kind's reader checks the content (size, strict parser).
export type DropKind = 'remix' | 'backup' | 'theme' | 'songlist'

const KINDS: [DropKind, RegExp][] = [
  ['remix', /\.lmix$/i],
  ['backup', /\.legato$/i],
  ['theme', /\.theme$/i],
  ['songlist', /\.(m3u8?|xspf|csv|tsv|txt)$/i],
]

/** The first of Legato's own files in a drop, in the order above; none = music, folders or a picture (the usual flow). */
export function ownFile(paths: string[]): { kind: DropKind; path: string } | null {
  for (const [kind, ext] of KINDS) {
    const path = paths.find((p) => ext.test(p))
    if (path) return { kind, path }
  }
  return null
}

/** A list's name from its file: "Road trip.m3u8" → "Road trip". */
export const nameOfFile = (path: string) => (path.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '').trim() || 'Playlist'

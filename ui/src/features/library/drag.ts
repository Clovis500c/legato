import { trn } from '../../shared/i18n/i18n'

/**
 * Songs dragged out of a list (TrackTable) onto a playlist (sidebar) or to another row of the same custom playlist.
 * Same window only: the ids stay here, the drag data only marks what it is.
 */
const MIME = 'application/x-musicapp-tracks'

let now: { ids: number[]; from?: { playlist: number; row: number } } | null = null

export const dragged = () => now

export const isTrackDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(MIME)

export function startDrag(e: React.DragEvent, ids: number[], title: string, from?: { playlist: number; row: number }) {
  now = { ids, from }
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData(MIME, String(ids.length))
  e.dataTransfer.setData('text/plain', title)
  // A label under the pointer: the song, or how many.
  const tag = document.createElement('div')
  tag.textContent = ids.length === 1 ? title : trn(ids.length, '{n} song', '{n} songs')
  tag.setAttribute('aria-hidden', 'true')
  Object.assign(tag.style, { position: 'fixed', top: '-100px', left: '0', padding: '6px 12px', borderRadius: '999px', background: 'var(--ink)', color: 'var(--bg)', font: '600 13px var(--font-ui)', whiteSpace: 'nowrap', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis' })
  document.body.append(tag)
  e.dataTransfer.setDragImage(tag, 12, 16)
  setTimeout(() => tag.remove())
}

export const endDrag = () => void (now = null)

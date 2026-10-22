import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'

// Playlist edits with a toast each: added (Open), already there (Add anyway), removed (Undo).
const app = () => useStore.getState()
const nameOf = (id: number) => app().playlists.find((p) => p.id === id)?.name ?? tr('the playlist')
const titleOf = (id: number) => app().tracks.find((t) => t.id === id)?.title ?? tr('Song')

/** "“Song”" for one, "3 songs" for more. */
export function songs(ids: number[]) {
  return ids.length === 1 ? tr('“{title}”', { title: titleOf(ids[0]) }) : trn(ids.length, '{n} song', '{n} songs')
}

/** Edit through the store (it shows its own error); true when it went through. */
async function edit(e: Parameters<ReturnType<typeof app>['editPlaylist']>[0]) {
  await app().editPlaylist(e)
  return !app().error
}

/** Add to one of your playlists. Already there: nothing added, toast offers to add them twice. */
export async function addToPlaylist(id: number, trackIds: number[], force = false) {
  if (!trackIds.length) return
  const have = new Set(app().orders[id] ?? [])
  const fresh = force ? trackIds : trackIds.filter((t) => !have.has(t))
  const name = nameOf(id)
  if (!fresh.length) {
    app().notify(trackIds.length === 1 ? tr('Already in {name}', { name }) : tr('All already in {name}', { name }), { kind: 'info', action: { label: tr('Add anyway'), run: () => void addToPlaylist(id, trackIds, true) } })
    return
  }
  if (!(await edit({ type: 'add', id, trackIds: fresh }))) return
  const skipped = trackIds.length - fresh.length
  app().notify(tr('Added to {name}: {songs}', { name, songs: songs(fresh) }) + (skipped ? ` · ${trn(skipped, '{n} already there', '{n} already there')}` : ''), { action: { label: tr('Open'), run: () => app().go({ name: 'playlist', id }) } })
}

/** Every occurrence of a song out of one of your playlists; Undo puts each back where it was. */
export async function removeTrackFromPlaylist(id: number, trackId: number) {
  const positions = (app().orders[id] ?? []).flatMap((t, i) => (t === trackId ? [i] : []))
  if (!(await edit({ type: 'removeTrack', id, trackId }))) return
  const undo = async () => {
    // Ascending: each one lands where it was.
    for (const pos of positions) {
      if (!(await edit({ type: 'add', id, trackIds: [trackId] }))) return
      const last = (app().orders[id]?.length ?? 1) - 1
      if (last !== pos) await edit({ type: 'move', id, from: last, to: pos })
    }
  }
  app().notify(tr('Removed from {name}: {songs}', { name: nameOf(id), songs: songs([trackId]) }), { kind: 'removed', action: { label: tr('Undo'), run: () => void undo() } })
}

/** Remove the song at `position`; Undo puts it back in the same place. */
export async function removeFromPlaylist(id: number, position: number) {
  const trackId = app().orders[id]?.[position]
  if (!(await edit({ type: 'remove', id, position }))) return
  const undo = async () => {
    if (trackId === undefined || !(await edit({ type: 'add', id, trackIds: [trackId] }))) return
    const last = (app().orders[id]?.length ?? 1) - 1
    if (last !== position) await edit({ type: 'move', id, from: last, to: position })
  }
  app().notify(tr('Removed from {name}: {songs}', { name: nameOf(id), songs: trackId === undefined ? tr('a song') : songs([trackId]) }), { kind: 'removed', action: trackId === undefined ? undefined : { label: tr('Undo'), run: () => void undo() } })
}

/** Removes several songs (positions) at once: one toast, Undo puts each back in its place. */
export async function removePositions(id: number, positions: number[]) {
  const order = app().orders[id] ?? []
  const gone = [...new Set(positions)].sort((a, b) => a - b).flatMap((p) => (order[p] === undefined ? [] : [[p, order[p]] as const]))
  // From the end: earlier positions stay valid.
  for (const [p] of [...gone].reverse()) if (!(await edit({ type: 'remove', id, position: p }))) return
  const undo = async () => {
    for (const [p, trackId] of gone) {
      if (!(await edit({ type: 'add', id, trackIds: [trackId] }))) return
      const last = (app().orders[id]?.length ?? 1) - 1
      if (last !== p) await edit({ type: 'move', id, from: last, to: p })
    }
  }
  if (gone.length) app().notify(tr('Removed from {name}: {songs}', { name: nameOf(id), songs: songs(gone.map(([, t]) => t)) }), { kind: 'removed', action: { label: tr('Undo'), run: () => void undo() } })
}

/**
 * The user's word on music or not, above the app's guess (null = the guess again); the lists follow. Hidden as not
 * music: Undo in the toast.
 */
export async function markMusic(ids: number[], music: boolean | null) {
  try {
    await api.setMusic(ids, music)
    await app().refresh()
  } catch (e) {
    return app().notify(String(e), { kind: 'error' })
  }
  if (music === false) app().notify(tr('{songs} hidden: not music', { songs: songs(ids) }), { action: { label: tr('Undo'), run: () => void markMusic(ids, null) } })
  else if (music) app().notify(tr('{songs} back with your music', { songs: songs(ids) }))
}

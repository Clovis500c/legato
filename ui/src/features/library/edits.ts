import { useStore } from '../../app/store'

// Playlist edits with a toast each: added (Open), already there (Add anyway), removed (Undo).
const app = () => useStore.getState()
const nameOf = (id: number) => app().playlists.find((p) => p.id === id)?.name ?? 'the playlist'
const titleOf = (id: number) => app().tracks.find((t) => t.id === id)?.title ?? 'Song'

/** "“Song”" for one, "3 songs" for more. */
export function songs(ids: number[]) {
  return ids.length === 1 ? `“${titleOf(ids[0])}”` : `${ids.length} songs`
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
    app().notify(`${trackIds.length === 1 ? 'Already' : 'All already'} in ${name}`, { kind: 'info', action: { label: 'Add anyway', run: () => void addToPlaylist(id, trackIds, true) } })
    return
  }
  if (!(await edit({ type: 'add', id, trackIds: fresh }))) return
  const skipped = trackIds.length - fresh.length
  app().notify(`Added ${songs(fresh)} to ${name}${skipped ? ` · ${skipped} already there` : ''}`, { action: { label: 'Open', run: () => app().go({ name: 'playlist', id }) } })
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
  app().notify(`Removed ${trackId === undefined ? 'song' : songs([trackId])} from ${nameOf(id)}`, { kind: 'removed', action: trackId === undefined ? undefined : { label: 'Undo', run: () => void undo() } })
}

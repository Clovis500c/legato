import { useStore } from '../../app/store'
import { api, type LibraryPlaylist, type LibraryTrack } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { isRemote, usePlayer } from './store'

// Like button (user's request 2026-10-26): song into the library and Liked Music. Signed in to YouTube Music = the
// account's own Liked Music (a real like there); else, or no YouTube version, a playlist of yours by that name.
const NAME = 'Liked Music'
const app = () => useStore.getState()

const youtubeLiked = (playlists: LibraryPlaylist[]) => playlists.find((p) => p.source === 'youtube' && !p.custom && p.sourceId === 'LM')
const ownLiked = (playlists: LibraryPlaylist[]) => playlists.find((p) => p.custom && p.name === NAME)

/** Library row id of a song; a recommendation once added shows up by its video. */
function libraryId(t: LibraryTrack, tracks: LibraryTrack[]) {
  if (!isRemote(t)) return t.id
  return t.ids.youtube ? tracks.find((x) => x.ids.youtube === t.ids.youtube)?.id : undefined
}

/** Liked Music playlists holding the song. */
function holding(t: LibraryTrack) {
  const { playlists, orders, tracks } = app()
  const id = libraryId(t, tracks)
  if (id === undefined) return []
  return [youtubeLiked(playlists), ownLiked(playlists)].filter((p): p is LibraryPlaylist => !!p && !!orders[p.id]?.includes(id))
}

export function useLiked(t: LibraryTrack | undefined) {
  // Re-run on library or playlist changes.
  useStore((s) => s.orders)
  useStore((s) => s.tracks)
  return !!t && holding(t).length > 0
}

/** Thumbs down: ranked lower in mixes (Undo = back to normal), and on to the next song. */
export function lessLikeThis(t: LibraryTrack) {
  const fail = (e: unknown) => app().notify(String(e), { kind: 'error' })
  api
    .setTrackPref(t.id, 'less')
    .then(() => app().notify(tr('Less of this in your mixes'), { action: { label: tr('Undo'), run: () => void api.setTrackPref(t.id, null).catch(fail) } }), fail)
  usePlayer.getState().step(1)
}

export async function toggleLike(t: LibraryTrack) {
  try {
    const held = holding(t)
    if (held.length) {
      const id = libraryId(t, app().tracks)!
      for (const p of held) {
        if (p.custom) await app().editPlaylist({ type: 'removeTrack', id: p.id, trackId: id })
        else await api.removeFromPlaylist(p.id, id)
      }
      await app().refreshChanged()
      return
    }
    const id = libraryId(t, app().tracks) ?? (await api.addTrack(t))
    await app().refreshChanged()
    const yt = app().status.youtube.connected && t.ids.youtube ? youtubeLiked(app().playlists) : undefined
    // Refused by YouTube Music (signed out): kept in your own list, liked there at the next sync (sync_all).
    let refused: unknown = null
    if (yt)
      await api.addToYoutube(yt.id, [id]).catch((e: unknown) => {
        refused = e
      })
    if (!yt || refused) {
      const own = ownLiked(app().playlists)?.id ?? (await app().editPlaylist({ type: 'create', name: NAME }))
      if (own === null) return
      await app().editPlaylist({ type: 'add', id: own, trackIds: [id] })
    }
    await app().refreshChanged()
    app().notify(tr('Added to {name}: {songs}', { name: NAME, songs: tr('“{title}”', { title: t.title }) }))
    if (refused) app().notify(String(refused), { kind: 'error' })
  } catch (e) {
    app().notify(String(e), { kind: 'error' })
  }
}

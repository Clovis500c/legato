import { useStore } from '../../app/store'
import { api, type LibraryPlaylist, type LibraryTrack } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { isRemote } from './store'

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

export async function toggleLike(t: LibraryTrack) {
  try {
    const held = holding(t)
    if (held.length) {
      const id = libraryId(t, app().tracks)!
      for (const p of held) {
        if (p.custom) await app().editPlaylist({ type: 'removeTrack', id: p.id, trackId: id })
        else await api.removeFromPlaylist(p.id, id)
      }
      await app().refresh()
      return
    }
    const id = libraryId(t, app().tracks) ?? (await api.addTrack(t))
    await app().refresh()
    const yt = app().status.youtube.connected && t.ids.youtube ? youtubeLiked(app().playlists) : undefined
    if (yt) await api.addToYoutube(yt.id, [id])
    else {
      const own = ownLiked(app().playlists)?.id ?? (await app().editPlaylist({ type: 'create', name: NAME }))
      if (own === null) return
      await app().editPlaylist({ type: 'add', id: own, trackIds: [id] })
    }
    await app().refresh()
    app().notify(tr('Added to {name}: {songs}', { name: NAME, songs: tr('“{title}”', { title: t.title }) }))
  } catch (e) {
    app().notify(String(e), { kind: 'error' })
  }
}

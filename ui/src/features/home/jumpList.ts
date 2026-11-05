import { playlistSongs, useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr, useLang } from '../../shared/i18n/i18n'
import { shufflePlay } from '../menus'
import { usePlayer } from '../player/store'
import { jumpPlaylists, useOpenedLists } from './recentLists'

/** An entry picked in the taskbar's Jump List (src-tauri/src/jumplist.rs): Shuffle all, or a playlist from its start. */
async function act(jump: string) {
  if (jump === 'shuffle') return shufflePlay(useStore.getState().tracks)
  const id = Number(jump.slice('playlist:'.length))
  // Deleted since the list was written: nothing.
  if (!jump.startsWith('playlist:') || !useStore.getState().playlists.some((p) => p.id === id)) return
  useStore.getState().go({ name: 'playlist', id })
  const tracks = await playlistSongs(id).catch(() => [])
  if (tracks.length) usePlayer.getState().playTracks(tracks, 0)
}

/**
 * The taskbar's Jump List: Shuffle all, then the playlists opened lately. An entry picked waits in Rust until taken: now
 * (the app started from it) and at each "jump" (picked while the app runs). The list follows the playlists opened, their
 * names and the language, written again once they settle. Returns cleanup.
 */
export function startJumpList(): () => void {
  const take = () =>
    void api
      .jumpPending()
      .then((j) => (j ? act(j) : undefined))
      .catch(() => {})
  take()
  const offJump = api.onJump(take)
  let timer: ReturnType<typeof setTimeout> | undefined
  let sent = ''
  const write = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const playlists = jumpPlaylists(useOpenedLists.getState().list, useStore.getState().playlists)
      const ask: Parameters<typeof api.setJumpList> = [tr('Shuffle all'), tr('Recent playlists'), playlists]
      const key = JSON.stringify(ask)
      if (key === sent) return
      sent = key
      void api.setJumpList(...ask).catch(() => {})
    }, 2000)
  }
  write()
  const offs = [
    useOpenedLists.subscribe(write),
    useLang.subscribe(write),
    useStore.subscribe((s, prev) => {
      if (s.playlists !== prev.playlists) write()
    }),
  ]
  return () => {
    clearTimeout(timer)
    offs.forEach((f) => f())
    void offJump.then((f) => f())
  }
}

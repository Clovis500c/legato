import { create } from 'zustand'
import { playlistSongs, useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { isLiked, toggleLike } from '../player/like'
import { nowTrack, usePlayer } from '../player/store'
import { nudgeVolume } from '../player/volume'
import type { VoiceCommand } from './voiceCommand'

/** Bumped by the "Search by voice" shortcut: the search bar's mic listens (VoiceSearch.tsx). */
export const useVoiceAsk = create<{ n: number }>(() => ({ n: 0 }))

/** Does what was said; a toast says what, with Search instead (a song may be called "Pause"). */
export async function runVoice(cmd: VoiceCommand, said: string) {
  const app = useStore.getState()
  const p = usePlayer.getState()
  const done = (what: string) => app.notify(tr('Voice: {done}', { done: what }), { action: { label: tr('Search instead'), run: () => (app.setQuery(said), app.searchFor(said)) } })
  switch (cmd.action) {
    case 'next':
      p.step(1)
      return done(tr('Next track'))
    case 'previous':
      p.step(-1)
      return done(tr('Previous track'))
    case 'pause':
      if (p.playing) p.toggle()
      return done(tr('Pause'))
    case 'play':
      if (!p.playing && p.now) p.toggle()
      return done(tr('Play'))
    case 'louder':
      nudgeVolume(0.1)
      return done(tr('Volume up'))
    case 'quieter':
      nudgeVolume(-0.1)
      return done(tr('Volume down'))
    case 'like': {
      // Liking only: a voice never takes a like away. toggleLike says it itself (a recommendation joins the library).
      const t = nowTrack()
      if (!t) return
      if (isLiked(t)) return done(tr('Already liked'))
      return void toggleLike(t)
    }
    case 'playlist': {
      const list = app.playlists.find((x) => x.id === cmd.id)
      const songs = list ? await playlistSongs(list.id).catch(() => []) : []
      if (!list || !songs.length) return
      usePlayer.getState().playTracks(songs, 0)
      return done(list.name)
    }
  }
}

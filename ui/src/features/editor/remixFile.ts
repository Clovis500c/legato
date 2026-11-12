import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { saveFile } from '../../shared/files'
import { tr } from '../../shared/i18n/i18n'
import { remoteTrack, usePlayer } from '../player/store'
import { applyPreset, useEditor } from './editor'

/** The remix file (`.lmix`, music_dsp::lmix): a YouTube video and the Live Editor's settings for it, never audio. */
const fail = (e: unknown) => void useStore.getState().notify(String(e), { kind: 'error' })

/** Waits (5 s at most) until the editor has loaded this song: its own load would overwrite settings applied sooner. */
function editorOn(song: string): Promise<boolean> {
  if (useEditor.getState().song === song) return Promise.resolve(true)
  return new Promise((done) => {
    const off = useEditor.subscribe((s) => {
      if (s.song !== song) return
      off()
      clearTimeout(timer)
      done(true)
    })
    const timer = setTimeout(() => (off(), done(false)), 5000)
  })
}

/** A dropped remix file: its song plays with the Live Editor open on its settings. The file is checked by Rust. */
export async function openRemix(path: string) {
  try {
    const mix = await api.lmixRead(path)
    const song = remoteTrack({ title: mix.title || mix.name, artist: mix.artist || 'YouTube', album: null, durationMs: null, isrc: null, ids: { youtube: mix.video }, art: `https://i.ytimg.com/vi/${mix.video}/hqdefault.jpg`, musicness: null, explicit: false })
    usePlayer.getState().playTracks([song], 0)
    if (await editorOn(`yt:${mix.video}`)) applyPreset(mix.effects)
    useSettings.getState().update({ editor: true })
    usePlayer.getState().setFull(true)
    useStore.getState().notify(tr('Remix “{name}” opened in the Live Editor', { name: mix.name }))
  } catch (e) {
    fail(e)
  }
}

/** The playing YouTube song with the settings now in the editor, as a file to share. */
export async function exportRemix() {
  const { now } = usePlayer.getState()
  if (!now?.youtubeId) return useStore.getState().notify(tr('Only a song playing from YouTube can be shared as a remix file'))
  const name = (now.title || 'Remix').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Remix'
  const mix = { name: now.title || 'Remix', video: now.youtubeId, title: now.title, artist: now.artist, effects: useEditor.getState().effects }
  try {
    await saveFile({ defaultPath: `${name}.lmix`, filters: [{ name: tr('Legato remix'), extensions: ['lmix'] }] }, (path) => api.lmixWrite(path, mix))
  } catch (e) {
    fail(e)
  }
}

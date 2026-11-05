import { useSettings } from '../../app/settings'
import { playlistSongs, useStore } from '../../app/store'
import { api } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { shufflePlay } from '../menus'
import { nextAlarm } from './alarmTime'
import { usePlayer } from './store'

/** Its playlist from the first song, else all your songs shuffled; the volume comes up from silence over its fade. */
async function ring() {
  // Music already on: awake, nothing replaced.
  if (usePlayer.getState().playing) return
  const { playlist, fadeMin } = useSettings.getState().settings.alarm
  const list = useStore.getState().playlists.find((p) => p.id === playlist)
  const songs = list ? await playlistSongs(list.id).catch(() => []) : []
  const all = useStore.getState().tracks
  if (!songs.length && !all.length) return
  if (fadeMin) usePlayer.getState().wake(fadeMin * 60_000)
  if (songs.length) usePlayer.getState().playTracks(songs, 0)
  else shufflePlay(all)
  useStore.getState().notify(tr('Alarm: {name}', { name: songs.length && list ? list.name : tr('All your songs') }))
}

/**
 * The alarm (Settings › Playback › Alarm): its next ring kept in Rust (alarm.rs), so it rings from the tray too. Set
 * again when the setting changes and after each ring, or each one missed while the PC slept. Returns cleanup.
 */
export function startAlarm(): () => void {
  let armed: number | null | undefined
  const arm = () => {
    const at = nextAlarm(Date.now(), useSettings.getState().settings.alarm)
    if (at === armed) return
    armed = at
    void api.setAlarm(at).catch(() => {})
  }
  arm()
  const offRing = api.onAlarm((missed) => {
    armed = undefined
    if (!missed) void ring()
    arm()
  })
  const off = useSettings.subscribe((s, prev) => {
    if (s.settings.alarm !== prev.settings.alarm) arm()
  })
  return () => {
    off()
    void offRing.then((f) => f())
  }
}

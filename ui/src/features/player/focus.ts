import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { tr, trn } from '../../shared/i18n/i18n'
import { askText } from '../../shared/ui/Ask'
import { startSleep } from './sleep'
import { parseMinutes, sessionSongs, type SessionKind } from './focusMix'
import { usePlayer } from './store'

/**
 * Player menu › Focus session… / Workout session… (Settings › Playback › Focus sessions, off by default): a timer, a mix and an
 * end. Asks the length, plays the mix, and the sleep timer takes it from there (the music fades over its last three minutes
 * and pauses); a notice then says how many songs went by.
 */
export async function startSession(kind: SessionKind) {
  const { tracks, stats, notify } = useStore.getState()
  const minutes = parseMinutes((await askText({ title: tr('Session length in minutes (5 to 240)'), ok: tr('Start'), value: kind === 'focus' ? '25' : '30' })) ?? '')
  if (minutes === null) return
  const list = sessionSongs(kind, tracks, stats, useSettings.getState().settings.hideExplicit)
  if (!list.length) return notify(kind === 'focus' ? tr('Not enough songs you have played for a focus session') : tr('Not enough songs tagged 120 BPM or more for a workout'))
  usePlayer.getState().playTracks(list, 0)
  startSleep(minutes)
  notify(tr('Session started: {n} min, the music fades out at the end', { n: minutes }))
  let songs = 1
  const off = usePlayer.subscribe((s, prev) => {
    if (s.now && s.now !== prev.now) songs++
  })
  setTimeout(() => {
    off()
    notify(trn(songs, '{n} song in {min} min', '{n} songs in {min} min', { min: minutes }))
  }, minutes * 60_000 + 1000)
}

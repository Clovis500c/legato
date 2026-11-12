import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { askText } from '../../shared/ui/Ask'
import { useEditor } from '../editor/editor'
import { beatPeriod, clickAt, parseTempo } from './metronome'
import { songKey } from './effects'
import { usePlayer } from './store'

/** Beats counted in. */
export const COUNT_BEATS = 4

/** When each count-in click sounds, seconds after the start, and when the song begins, for a beat every `period` seconds. */
export const countInTimes = (period: number, beats = COUNT_BEATS): { clicks: number[]; start: number } => ({ clicks: Array.from({ length: beats }, (_, i) => i * period), start: beats * period })

/**
 * Player menu › Count in, then play (practice mode): the song waits, paused, while four clicks sound at its tempo (the tag's,
 * else typed), then plays from where it is.
 */
export async function countInPlay(known?: number) {
  const bpm = known ?? parseTempo((await askText({ title: tr('Metronome tempo (30 to 400 BPM)'), ok: tr('Start'), value: '120' })) ?? '')
  if (bpm === null) return
  const p = usePlayer.getState()
  if (!p.now) return
  const song = songKey(p.now)
  if (p.playing) p.pauseNow()
  // At the speed the song is heard (the Live Editor's), as the metronome does.
  const { clicks, start } = countInTimes(beatPeriod(bpm, useEditor.getState().effects))
  const ctx = new AudioContext()
  void ctx.resume()
  const t0 = ctx.currentTime + 0.1
  clicks.forEach((c, i) => clickAt(ctx, t0 + c, i === 0))
  useStore.getState().notify(tr('Counting in at {bpm} BPM', { bpm }))
  setTimeout(() => {
    void ctx.close()
    // Another song, or the player started by hand meanwhile: nothing to start.
    const now = usePlayer.getState()
    if (songKey(now.now) === song && !now.playing) now.toggle()
  }, (start + 0.1) * 1000)
}

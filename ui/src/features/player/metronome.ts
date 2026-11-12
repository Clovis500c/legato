import { create } from 'zustand'
import { useStore } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { askText } from '../../shared/ui/Ask'
import { useEditor } from '../editor/editor'
import { songKey } from './effects'
import { usePlayer } from './store'

/**
 * A metronome for practising: clicks at a tempo (the song's own tags when its file has one, else typed), from the player's
 * menu. It clicks on its own clock: it does not follow the song's beats, only its speed. It stops when asked or when
 * another song starts.
 */
export const useMetronome = create<{ bpm: number | null; song: string | null }>(() => ({ bpm: null, song: null }))

/** Click times in `[from, until)` for a beat every `period` seconds starting at `first` (seconds on one clock). */
export function clicksBetween(first: number, period: number, from: number, until: number): number[] {
  if (!(period > 0) || until <= from) return []
  const out: number[] = []
  for (let t = first + Math.max(0, Math.ceil((from - first) / period)) * period; t < until; t += period) out.push(t)
  return out
}

/** A typed tempo: whole BPM from 30 to 400, else none. */
export const parseTempo = (text: string): number | null => {
  const n = Math.round(Number(text.trim().replace(',', '.')))
  return Number.isFinite(n) && n >= 30 && n <= 400 ? n : null
}

/** Seconds between clicks at `bpm` as the song is heard: the Live Editor's speed and tempo, when on, play it faster or slower. */
export const beatPeriod = (bpm: number, e: { on: boolean; speed: number; tempo: number }) => 60 / (bpm * (e.on ? e.speed * e.tempo : 1))

let ctx: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | undefined
let next = 0

/** One click on `c`'s clock at `at` (seconds); louder pitch on the accent. */
export function clickAt(c: AudioContext, at: number, accent: boolean) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.frequency.value = accent ? 1600 : 1000
  g.gain.setValueAtTime(0.25, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
  o.connect(g).connect(c.destination)
  o.start(at)
  o.stop(at + 0.06)
}

const click = (at: number, accent: boolean) => ctx && clickAt(ctx, at, accent)

export function stopMetronome() {
  clearInterval(timer)
  timer = undefined
  useMetronome.setState({ bpm: null, song: null })
}

function startMetronome(bpm: number) {
  stopMetronome()
  ctx ??= new AudioContext()
  void ctx.resume()
  next = ctx.currentTime + 0.1
  let beat = 0
  // Scheduled a quarter of a second ahead, every 50 ms, on the audio clock (a timer alone would drift).
  timer = setInterval(() => {
    if (!ctx) return
    const period = beatPeriod(bpm, useEditor.getState().effects)
    for (const t of clicksBetween(next, period, ctx.currentTime, ctx.currentTime + 0.25)) click(t, beat++ % 4 === 0)
    while (next < ctx.currentTime + 0.25) next += period
  }, 50)
  useMetronome.setState({ bpm, song: songKey(usePlayer.getState().now) })
}

/** The menu's switch: off if on; else the song's tempo (`known`, from its file's tags) or a typed one. */
export async function toggleMetronome(known?: number) {
  if (useMetronome.getState().bpm !== null) return stopMetronome()
  const bpm = known ?? parseTempo((await askText({ title: tr('Metronome tempo (30 to 400 BPM)'), ok: tr('Start'), value: '120' })) ?? '')
  if (bpm === null) return
  startMetronome(bpm)
  useStore.getState().notify(tr('Metronome at {bpm} BPM', { bpm }))
}

/** Follows the player: another song stops the metronome. Returns cleanup. */
export function followSong(): () => void {
  return usePlayer.subscribe((s) => {
    const { song } = useMetronome.getState()
    if (song !== null && songKey(s.now) !== song) stopMetronome()
  })
}

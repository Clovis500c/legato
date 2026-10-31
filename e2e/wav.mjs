// The demo songs the smoke test writes: a pure tone each, 16-bit mono PCM WAV, long enough that the queue never reaches
// the next song during the walk (the first one lasts a minute). File names are "Artist - Title.wav": a bare WAV has no
// tags, and the scan splits the name (music_core::local::from_name).

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const DEMO_SONGS = [
  { file: 'Ada Quartet - First Light.wav', artist: 'Ada Quartet', title: 'First Light', seconds: 60, hz: 440 },
  { file: 'Ada Quartet - Second Wind.wav', artist: 'Ada Quartet', title: 'Second Wind', seconds: 40, hz: 523 },
  { file: 'Pebble and Rain - Low Tide.wav', artist: 'Pebble and Rain', title: 'Low Tide', seconds: 40, hz: 330 },
]

/** The bytes of a WAV file: `seconds` of a sine at `hz`, quiet (peak 0.3). */
export function sineWav(seconds, hz, rate = 44100) {
  const frames = Math.round(seconds * rate)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * hz * i) / rate)), i * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8, 'ascii')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'ascii')
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

/** Writes the demo songs into `dir` (made if missing). */
export function writeDemo(dir) {
  mkdirSync(dir, { recursive: true })
  for (const s of DEMO_SONGS) writeFileSync(path.join(dir, s.file), sineWav(s.seconds, s.hz))
  return DEMO_SONGS
}

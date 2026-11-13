import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { Button } from '../../shared/ui/Button'
import { tr, trn } from '../../shared/i18n/i18n'
import { usePlayer } from '../player/store'
import { pickRounds, SNIPPET_MS, snippetStart } from './rounds'
import { closeBlind } from './blindOpen'

/**
 * Blind test: ten songs of the library, a snippet of each (20 s from 30 % in), four answers. A full-window cover, so nothing of
 * the player (title, cover) gives the song away; the sound plays underneath and stops when a round is answered or the game ends.
 */
export function BlindTest() {
  const [game, setGame] = useState(() => pickRounds(useStore.getState().tracks))
  const [round, setRound] = useState(0)
  const [answer, setAnswer] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const done = round >= game.length
  const current = game[round]
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Each round: the song starts, goes to its snippet once its length is known, and stops 20 s later.
  useEffect(() => {
    if (!current || answer !== null) return
    usePlayer.getState().playTracks([current.song], 0)
    let moved = false
    const off = usePlayer.subscribe((s) => {
      if (moved || !s.durationMs || !s.playing) return
      moved = true
      s.seek(snippetStart(s.durationMs))
      timer.current = setTimeout(() => usePlayer.getState().pauseNow(), SNIPPET_MS)
    })
    return () => {
      off()
      clearTimeout(timer.current)
    }
  }, [current, answer])
  useEffect(() => () => usePlayer.getState().pauseNow(), [])

  const right = useMemo(() => (current ? current.choices.indexOf(current.song) : -1), [current])
  const pick = (i: number) => {
    if (answer !== null || !current) return
    usePlayer.getState().pauseNow()
    setAnswer(i)
    if (i === right) setScore((n) => n + 1)
  }
  const again = () => {
    setGame(pickRounds(useStore.getState().tracks))
    setRound(0)
    setAnswer(null)
    setScore(0)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Blind test')} className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-bg p-6 text-ink">
      {!game.length ? (
        <>
          <p className="max-w-md text-center text-ink-2">{tr('Not enough songs in your library for a blind test (8 at least)')}</p>
          <Button onClick={closeBlind}>{tr('Close')}</Button>
        </>
      ) : done ? (
        <>
          <h2 className="text-3xl font-black">{tr('Score: {score} of {total}', { score, total: game.length })}</h2>
          <div className="flex gap-2">
            <Button onClick={again}>{tr('Play again')}</Button>
            <Button variant="ghost" onClick={closeBlind}>
              {tr('Close')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-3">{trn(game.length, 'Round {r} of {n} song', 'Round {r} of {n} songs', { r: round + 1 })}</p>
          <h2 className="text-2xl font-black">{answer === null ? tr('Which song is playing?') : answer === right ? tr('Correct!') : tr('It was “{title}” by {artist}', { title: current.song.title, artist: current.song.artist })}</h2>
          <ul className="flex w-full max-w-xl flex-col gap-2">
            {current.choices.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={answer !== null}
                  onClick={() => pick(i)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition ${answer === null ? 'border-line bg-raised hover:border-ink-4' : i === right ? 'border-accent-ink bg-raised' : i === answer ? 'border-line bg-recess text-ink-3 line-through' : 'border-line bg-bg text-ink-3'}`}
                >
                  <span className="font-medium">{c.title}</span> <span className="text-ink-2">· {c.artist}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            {answer !== null ? (
              <Button
                onClick={() => {
                  setAnswer(null)
                  setRound((r) => r + 1)
                }}
              >
                {round + 1 >= game.length ? tr('See the score') : tr('Next round')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => (usePlayer.getState().pauseNow(), setRound((r) => r + 1))}>
                {tr('Skip')}
              </Button>
            )}
            <Button variant="ghost" onClick={closeBlind}>
              {tr('Close')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

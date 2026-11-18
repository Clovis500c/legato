import { useState } from 'react'
import { api, type Lyrics } from '../../shared/api'
import { explain } from '../../shared/errors'
import { lang, LANGUAGES, tr } from '../../shared/i18n/i18n'
import { Dialog } from '../../shared/ui/Dialog'
import { songKey } from './effects'
import { usePlayer } from './store'
import { useTranslated } from './translated'
import { translateTarget, wordsToTranslate } from './translateWords'

/** Settings › Playback › Translate lyrics: a button under the lyrics; the words leave only after the box's "Send and translate". */
export function TranslateLyrics({ lyrics }: { lyrics: Lyrics }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ from: string[]; to: string[] } | { error: string } | 'busy' | null>(null)
  const words = wordsToTranslate(lyrics)
  // The interface's language unless the user picks another (any language the app speaks).
  const [picked, setPicked] = useState<string | null>(null)
  const code = picked ?? translateTarget(lang())
  const name = (c: string) => new Intl.DisplayNames([lang()], { type: 'language' }).of(c) ?? c
  const language = name(code)
  const send = () => {
    setState('busy')
    // The song these words are from, taken now: the answer may come after the next song started.
    const song = songKey(usePlayer.getState().now) ?? ''
    api.translateLyrics(words, code).then(
      (to) => {
        setState({ from: words, to })
        // Kept in memory for this song: the panel shows it under the lines (LyricsPanel).
        useTranslated.setState({ song, code, from: words, to })
      },
      (e) => setState({ error: explain(e).text }),
    )
  }
  if (!words.some(Boolean)) return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-full border border-line px-1.5 py-px hover:text-ink">
        {tr('Translate…')}
      </button>
      {open && (
        <Dialog title={tr('Translate lyrics')} wide onClose={() => (setOpen(false), setState(null))}>
          {state === null && (
            <>
              <p className="text-sm text-ink-2">{tr('The words of this song will be sent to MyMemory (api.mymemory.translated.net) to be translated into {language}. Nothing else is sent.', { language })}</p>
              <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
                {tr('Translate into')}
                <select value={code} onChange={(e) => setPicked(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1 text-ink">
                  {[...new Set(LANGUAGES.map((l) => translateTarget(l.code)))].map((c) => (
                    <option key={c} value={c}>
                      {name(c)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-4 flex justify-end gap-2 text-sm">
                <button onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-ink-2 hover:text-ink">
                  {tr('Cancel')}
                </button>
                <button onClick={send} className="rounded-full bg-ink px-3 py-1 font-semibold text-bg">
                  {tr('Send and translate')}
                </button>
              </div>
            </>
          )}
          {state === 'busy' && <p className="text-sm text-ink-2">{tr('Translating…')}</p>}
          {state && typeof state === 'object' && 'error' in state && <p className="text-sm text-ink-2">{state.error}</p>}
          {state && typeof state === 'object' && 'to' in state && (
            <div className="max-h-[60vh] overflow-y-auto text-sm leading-relaxed">
              {state.from.map((line, i) => (
                <div key={i} className={line ? 'py-1' : 'py-2'}>
                  <div className="font-semibold">{line}</div>
                  <div className="text-ink-2">{state.to[i]}</div>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </>
  )
}

import { useState } from 'react'
import { api, type Lyrics } from '../../shared/api'
import { explain } from '../../shared/errors'
import { lang, tr } from '../../shared/i18n/i18n'
import { Dialog } from '../../shared/ui/Dialog'
import { translateTarget, wordsToTranslate } from './translateWords'

/** Settings › Playback › Translate lyrics: a button under the lyrics; the words leave only after the box's "Send and translate". */
export function TranslateLyrics({ lyrics }: { lyrics: Lyrics }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ from: string[]; to: string[] } | { error: string } | 'busy' | null>(null)
  const words = wordsToTranslate(lyrics)
  const code = translateTarget(lang())
  const language = new Intl.DisplayNames([lang()], { type: 'language' }).of(code) ?? code
  const send = () => {
    setState('busy')
    api.translateLyrics(words, code).then(
      (to) => setState({ from: words, to }),
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

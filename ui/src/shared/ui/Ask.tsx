import { useState } from 'react'
import { create } from 'zustand'
import { tr } from '../i18n/i18n'
import { Button } from './Button'
import { Dialog } from './Dialog'

/**
 * The app's own confirm / prompt. window.confirm is async under Tauri's dialog plugin (a Promise, always truthy) and
 * prompt is an unthemed, untranslated browser box: never use either.
 */
type Request = {
  id: number
  title: string
  body?: string
  ok: string
  /** Text asked for (prompt); undefined = yes / no. */
  text?: string
  done: (answer: string | boolean | null) => void
}

const useAsk = create<{ open: Request | null }>(() => ({ open: null }))
let seq = 0

function show(r: Omit<Request, 'done' | 'id'>): Promise<string | boolean | null> {
  return new Promise((done) => {
    // A second question replaces the first, which counts as canceled.
    const old = useAsk.getState().open
    old?.done(old.text === undefined ? false : null)
    useAsk.setState({ open: { ...r, id: ++seq, done } })
  })
}

/** Yes / no; resolves false on Cancel, Escape or a click outside. */
export async function ask(o: { title: string; body?: string; ok: string }): Promise<boolean> {
  return (await show(o)) === true
}

/** One line of text; resolves null when canceled or left empty. */
export async function askText(o: { title: string; ok: string; value?: string }): Promise<string | null> {
  const a = await show({ title: o.title, ok: o.ok, text: o.value ?? '' })
  return typeof a === 'string' && a.trim() ? a.trim() : null
}

/** Mounted once in App. */
export function Asker() {
  const open = useAsk((s) => s.open)
  return open && <Question key={open.id} r={open} />
}

function Question({ r }: { r: Request }) {
  const [text, setText] = useState(r.text ?? '')
  const end = (answer: string | boolean | null) => {
    useAsk.setState({ open: null })
    r.done(answer)
  }
  const cancel = () => end(r.text === undefined ? false : null)
  const ok = () => end(r.text === undefined ? true : text)
  return (
    <Dialog title={r.title} onClose={cancel}>
      {r.body && <p className="text-sm whitespace-pre-line text-ink-2">{r.body}</p>}
      {r.text !== undefined && (
        <input
          value={text}
          maxLength={100}
          aria-label={r.title}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && ok()}
          className="rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-ink-3"
        />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={cancel}>
          {tr('Cancel')}
        </Button>
        <Button data-default onClick={ok} disabled={r.text !== undefined && !text.trim()}>
          {r.ok}
        </Button>
      </div>
    </Dialog>
  )
}

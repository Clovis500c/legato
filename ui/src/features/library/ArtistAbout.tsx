import { useLayoutEffect, useRef, useState } from 'react'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { textMenu } from '../menus'

/** YouTube Music's About text: three lines, Read more for the rest (its credit line, at the end, kept). */
export function ArtistAbout({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  // Cut by the three lines: Read more. Measured again when the page narrows or widens.
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setCut(el.scrollHeight > el.clientHeight + 1)
    check()
    const watch = new ResizeObserver(check)
    watch.observe(el)
    return () => watch.disconnect()
  }, [text, open])
  return (
    <div className="flex max-w-3xl flex-col items-start gap-1.5" onContextMenu={onMenu(() => textMenu(text))}>
      <p ref={ref} className={`text-sm leading-relaxed whitespace-pre-line text-ink-2 ${open ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {(cut || open) && (
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs font-semibold text-ink-2 hover:text-ink">
          {open ? tr('Show less') : tr('Read more')}
        </button>
      )}
    </div>
  )
}

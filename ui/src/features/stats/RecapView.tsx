import { ArrowLeft, CaretLeft, CaretRight, Copy, DownloadSimple } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type LibraryTrack, type Play } from '../../shared/api'
import { trackArt } from '../../shared/art'
import { saveFile } from '../../shared/files'
import { fileName } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { RoundButton } from '../../shared/ui/controls'
import { PageHeader } from '../../shared/ui/PageHeader'
import { averageColor } from '../player/ambient'
import { cardBlob } from '../share/drawCard'
import { recapOf, recapSpans, type RecapSpan } from './recap'
import { recapCards, spanLabel, type RecapCard } from './recapCards'
import { cardColors, drawCard } from './recapDraw'

const keyOf = (s: RecapSpan) => `${s.year}-${s.month ?? 'all'}`

/** A card drawn: its picture, and the canvas a save writes. */
async function draw(card: RecapCard, tint: LibraryTrack | undefined): Promise<HTMLCanvasElement> {
  const src = trackArt(card.cover ?? tint ?? { ids: {}, art: null })[0]
  const colors = cardColors(src ? await averageColor(src) : null)
  await document.fonts.ready
  return drawCard(card, colors, getComputedStyle(document.body).fontFamily)
}

/** Your year or month in music, card by card (Stats › Your recap); each card saved as a 1080 × 1920 picture. */
export default function RecapView({ history, tracks, sub, onClose }: { history: Play[]; tracks: LibraryTrack[]; sub: string; onClose: () => void }) {
  const spans = useMemo(() => recapSpans(history), [history])
  const [span, setSpan] = useState(spans[0])
  const recap = useMemo(() => recapOf(history, tracks, span), [history, tracks, span])
  const cards = useMemo(() => recapCards(recap), [recap])
  const [at, setAt] = useState(0)
  const card = cards[Math.min(at, cards.length - 1)]
  // Cards without a cover take the top song's colours.
  const tint = recap.stats.topSongs[0]?.item
  const [shown, setShown] = useState<{ card: RecapCard; url: string } | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let live = true
    void draw(card, tint).then((c) => {
      if (!live) return
      canvas.current = c
      setShown({ card, url: c.toDataURL('image/jpeg', 0.92) })
    })
    return () => {
      live = false
    }
  }, [card, tint])

  // ← → between cards, Esc back to Stats.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setAt((i) => Math.min(cards.length - 1, i + 1))
      else if (e.key === 'Escape') onClose()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cards.length, onClose])

  // The share card's own ways out: a PNG (or JPEG) file, the clipboard.
  const save = async () => {
    const c = canvas.current
    if (!c || shown?.card !== card) return
    const { notify } = useStore.getState()
    try {
      const bytes = new Uint8Array(await (await cardBlob(c)).arrayBuffer())
      const filters = [
        { name: tr('PNG image'), extensions: ['png'] },
        { name: tr('JPEG image'), extensions: ['jpg'] },
      ]
      const name = await saveFile({ title: tr('Save picture'), defaultPath: `${fileName(`Legato ${spanLabel(span)} ${card.id}`)}.png`, filters }, (path) => api.savePicture(bytes, path))
      if (name) notify(tr('Picture saved: {file}', { file: name }))
    } catch (e) {
      notify(String(e))
    }
  }
  const copy = async () => {
    const c = canvas.current
    if (!c || shown?.card !== card) return
    const { notify } = useStore.getState()
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await cardBlob(c) })])
      notify(tr('Picture copied'))
    } catch {
      notify(tr('The picture could not be copied'))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pb-6">
      <PageHeader
        title={tr('Your recap')}
        sub={sub}
        actions={
          <>
            <select
              aria-label={tr('Period')}
              value={keyOf(span)}
              onChange={(e) => {
                setSpan(spans.find((s) => keyOf(s) === e.target.value) ?? spans[0])
                setAt(0)
              }}
              className="rounded-md border border-line bg-bg px-2 py-1.5 text-[0.8125rem]"
            >
              {spans.map((s) => (
                <option key={keyOf(s)} value={keyOf(s)}>
                  {spanLabel(s)}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={onClose}>
              <ArrowLeft size={14} />
              {tr('Back to stats')}
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4">
        <RoundButton label={tr('Previous')} disabled={at === 0} onClick={() => setAt(at - 1)}>
          <CaretLeft size={18} />
        </RoundButton>
        <div className="aspect-[9/16] h-full max-h-[min(72vh,720px)] min-h-0 overflow-hidden rounded-2xl bg-raised shadow-lg">
          {shown && <img src={shown.url} alt={[card.kicker, card.title, card.sub, ...(card.rows ?? []).map((r) => r.title), ...(card.figures ?? []).map((f) => `${f.value} ${f.label}`)].filter(Boolean).join(' · ')} className="size-full" />}
        </div>
        <RoundButton label={tr('Next')} disabled={at >= cards.length - 1} onClick={() => setAt(at + 1)}>
          <CaretRight size={18} />
        </RoundButton>
      </div>
      {/* A phone in a long language: the buttons wrap whole, never their words. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 whitespace-nowrap">
        <span className="text-xs text-ink-3 tabular-nums">
          {at + 1} / {cards.length}
        </span>
        <Button variant="ghost" onClick={() => void copy()} disabled={shown?.card !== card}>
          <Copy size={14} />
          {tr('Copy picture')}
        </Button>
        <Button onClick={() => void save()} disabled={shown?.card !== card}>
          <DownloadSimple size={14} />
          {tr('Save picture…')}
        </Button>
      </div>
    </div>
  )
}

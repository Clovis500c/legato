import { CaretLeft, CaretRight } from '../../shared/ui/directional'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { api, type ShareCode } from '../../shared/api'
import { saveFile } from '../../shared/files'
import { artistName } from '../../shared/artistName'
import { bigTrackArt } from '../../shared/art'
import { fileName } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { RoundButton, Segmented, Toggle } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { songKey } from '../player/effects'
import { lineAt } from '../player/lyricsAt'
import { useNowLyrics } from '../player/LyricsPanel'
import { positionNow } from '../player/Progress'
import { useNowTrack, usePlayer } from '../player/store'
import { cardBlob, drawCard, type CardLook } from './drawCard'
import { closeShare } from './share'
import { pickableLines } from './shareCard'

/**
 * Share the song playing as a picture: the card (drawCard.ts) previewed, the cover's colors or the theme's, a lyric
 * line (the one playing when opened, ← → for another). Copied for a chat or a post, or saved as PNG / JPEG. Nothing is
 * sent anywhere.
 */
export function ShareDialog() {
  const now = usePlayer((s) => s.now)
  const track = useNowTrack()
  const { mine } = useNowLyrics()
  const notify = useStore((s) => s.notify)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [look, setLook] = useState<CardLook>('cover')
  const [withLine, setWithLine] = useState(true)
  // The song's code: a QR in the card's corner and a link hidden in the saved PNG, so the picture brings the song back.
  const [withCode, setWithCode] = useState(true)
  const [code, setCode] = useState<ShareCode | null>(null)
  const l = mine?.lyrics ?? undefined
  const lines = useMemo(() => pickableLines(l?.lines, l?.plain ?? undefined), [l])
  // The line playing when the lyrics came (again for the next song); null until then.
  const [pick, setPick] = useState<number | null>(null)
  const song = songKey(now)
  useEffect(() => setPick(null), [song])
  useEffect(() => {
    if (!lines.length || pick !== null) return
    const timed = l?.lines ?? []
    const i = timed.length ? lineAt(timed, positionNow()) : -1
    setPick(Math.max(0, lines.indexOf(timed[i]?.text.trim() ?? '')))
  }, [lines, l, pick])
  const line = withLine && pick !== null ? lines[pick] : undefined
  const art = useMemo(() => (track ? bigTrackArt(track) : []), [track])
  const title = now?.title ?? ''
  const artist = now ? artistName(now.artist) : ''
  const youtube = now?.youtubeId ?? track?.ids.youtube ?? null
  useEffect(() => {
    setCode(null)
    if (!title) return
    let live = true
    api.songCode(title, artist, youtube).then((c) => live && setCode(c), () => {})
    return () => {
      live = false
    }
  }, [title, artist, youtube])
  const cardCode = withCode ? code?.qr ?? null : null
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!canvas.current || !now) return
    let live = true
    setReady(false)
    drawCard(canvas.current, art, { title, artist, line }, look, cardCode).then(
      () => live && setReady(true),
      () => live && setReady(true),
    )
    return () => {
      live = false
    }
  }, [art, title, artist, line, look, now, cardCode])
  useEffect(() => {
    if (!now) closeShare()
  }, [now])

  const copy = async () => {
    try {
      const blob = await cardBlob(canvas.current!)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      notify(tr('Picture copied'))
    } catch {
      notify(tr('The picture could not be copied'))
    }
  }
  const keep = async () => {
    try {
      const bytes = new Uint8Array(await (await cardBlob(canvas.current!)).arrayBuffer())
      const name = await saveFile(
        {
          title: tr('Save picture'),
          defaultPath: `${fileName(`${artist} - ${title}`)}.png`,
          filters: [
            { name: tr('PNG image'), extensions: ['png'] },
            { name: tr('JPEG image'), extensions: ['jpg'] },
          ],
        },
        (path) => api.savePicture(bytes, path, withCode ? code?.link : undefined),
      )
      if (name) notify(tr('Picture saved: {file}', { file: name }))
    } catch (e) {
      notify(String(e))
    }
  }
  const step = (d: number) => setPick((p) => ((p ?? 0) + d + lines.length) % lines.length)

  return (
    <Dialog title={tr('Share as a picture')} kicker={title} onClose={closeShare}>
      <canvas ref={canvas} aria-label={tr('Share as a picture')} className={`mx-auto aspect-[4/5] w-full max-w-72 rounded-lg border border-line-soft transition-opacity ${ready ? '' : 'opacity-60'}`} />
      <Segmented
        label={tr('Colors')}
        value={look}
        onChange={setLook}
        options={[
          { value: 'cover', label: tr('Cover') },
          { value: 'theme', label: tr('Theme') },
        ]}
      />
      <div className="flex items-center gap-3 text-sm">
        <Toggle label={tr('Code to bring the song back')} checked={withCode} onChange={setWithCode} />
        <span className="min-w-0 flex-1 truncate text-ink-2">{tr('Code to bring the song back')}</span>
      </div>
      {lines.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <Toggle label={tr('Lyric line')} checked={withLine} onChange={setWithLine} />
          <span className="min-w-0 flex-1 truncate text-ink-2">{tr('Lyric line')}</span>
          <RoundButton label={tr('Previous line')} kind="plain" size="sm" disabled={!withLine} onClick={() => step(-1)}>
            <CaretLeft size={15} />
          </RoundButton>
          <RoundButton label={tr('Next line')} kind="plain" size="sm" disabled={!withLine} onClick={() => step(1)}>
            <CaretRight size={15} />
          </RoundButton>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void keep()}>
          {tr('Save picture…')}
        </Button>
        <Button data-default onClick={() => void copy()}>
          {tr('Copy picture')}
        </Button>
      </div>
    </Dialog>
  )
}

import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { type LibraryPlaylist } from '../../shared/api'
import { sizedArt, trackArt } from '../../shared/art'
import { tr } from '../../shared/i18n/i18n'
import { onMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { playlistMenu } from '../menus'
import { averageColor } from '../player/ambient'
import { bannerCovers, byIdOf, initialOf, pageOf, wallGrid, washOf } from './banner'

/** Playlists as banners, always (loaded with the playlist page and Home, not at launch): a wall of the playlist's covers under a colour taken from them. Covers come through the `art` scheme, nothing from the network. */

/** The covers of a playlist and the wash over them (the first cover's colour; the name's hue until it is read, or without a cover). */
function useBanner(p: LibraryPlaylist, to: 'bottom' | 'start' = 'bottom') {
  const ids = useStore((s) => s.orders[p.id])
  const tracks = useStore((s) => s.tracks)
  useSettings((s) => s.settings.theme)
  useSettings((s) => s.systemDark)
  const dark = useSettings.getState().current().dark
  const arts = useMemo(() => {
    return bannerCovers(ids, byIdOf(tracks)).map((t) => trackArt(t)[0])
  }, [ids, tracks])
  const first = arts[0]
  const [rgb, setRgb] = useState<[number, number, number] | null>(null)
  useEffect(() => {
    let live = true
    setRgb(null)
    if (first) void averageColor(first).then((c) => live && setRgb(c))
    return () => {
      live = false
    }
  }, [first])
  return { arts, wash: washOf(rgb, p.name, dark, to) }
}

/**
 * The wall: rows of square covers side by side, every other row shifted by half a cover, the whole wall tilted with a little
 * perspective (mirrored in right-to-left) and made big enough to fill its box whatever the width (2 560 px included): the number
 * of columns follows the box's size. Covers repeat, shifted, when the playlist has fewer than the cells (banner.ts `wallGrid`).
 * Decorative: the name is the label. Still: nothing moves, so reduced motion has nothing to turn off.
 */
function Wall({ arts, rows }: { arts: string[]; rows: number }) {
  const box = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ w: 1200, h: 230 })
  useEffect(() => {
    const e = box.current
    if (!e) return
    const measure = () => setSize({ w: e.clientWidth || 1200, h: e.clientHeight || 230 })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(e)
    return () => watch.disconnect()
  }, [])
  // Rows tall enough to cover the tilt's corners: a row more than the box shows on each side.
  const cell = Math.max(36, Math.ceil(size.h / rows))
  const shown = rows + 2
  const cols = Math.min(90, Math.ceil((size.w * 1.4) / cell) + 3)
  const grid = wallGrid(arts.length, shown, cols)
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return (
    <span ref={box} aria-hidden className="absolute inset-0 overflow-hidden [perspective:900px]">
      <span className="absolute start-1/2 top-1/2 flex flex-col [transform-origin:center] [transform:translate(-50%,-50%)_rotateX(8deg)_rotate(-9deg)] rtl:[transform:translate(50%,-50%)_rotateX(8deg)_rotate(9deg)]" style={{ width: cols * cell }}>
        {grid.map((row, r) => (
          <span key={r} className="flex shrink-0" style={{ height: cell, marginInlineStart: r % 2 ? -cell / 2 : 0 }}>
            {row.map((i, c) => (
              <img key={c} src={sizedArt(arts[i], cell, dpr)} alt="" draggable={false} loading="lazy" decoding="async" width={cell} height={cell} className="shrink-0 object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            ))}
          </span>
        ))}
      </span>
    </span>
  )
}

/** One tile: the wall (or, without covers, the plain wash and the name's first letter), the wash, the name in white capitals. */
function Face({ p }: { p: LibraryPlaylist }) {
  const { arts, wash } = useBanner(p)
  return (
    <>
      <Wall arts={arts} rows={3} />
      <span aria-hidden className="absolute inset-0" style={{ background: wash }} />
      {!arts.length && (
        <span aria-hidden className="absolute inset-0 grid place-items-center text-7xl font-black text-white/20">
          {initialOf(p.name)}
        </span>
      )}
      <span className="absolute inset-0 grid place-items-center px-5 text-center">
        <span className="line-clamp-2 text-lg font-extrabold tracking-[0.08em] break-words text-white uppercase [text-shadow:0_1px_8px_rgb(0_0_0/0.55)]">{p.name}</span>
      </span>
    </>
  )
}

/** "Browse your playlists": tiles in a row that snaps, arrows at both ends, a dot for each page. */
export function BannerCarousel({ playlists, open }: { playlists: LibraryPlaylist[]; open: (p: LibraryPlaylist) => void }) {
  const list = useRef<HTMLUListElement>(null)
  const [at, setAt] = useState({ page: 0, pages: 1 })
  useEffect(() => {
    const e = list.current
    if (!e) return
    const measure = () => setAt(pageOf(e.scrollLeft, e.clientWidth, e.scrollWidth))
    measure()
    e.addEventListener('scroll', measure, { passive: true })
    const watch = new ResizeObserver(measure)
    watch.observe(e)
    return () => {
      e.removeEventListener('scroll', measure)
      watch.disconnect()
    }
  }, [playlists.length])
  const move = (page: number) => {
    const e = list.current
    if (!e) return
    const sign = getComputedStyle(e).direction === 'rtl' ? -1 : 1
    e.scrollTo({ left: sign * page * e.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <RoundButton label={tr('Show previous playlists')} kind="plain" disabled={at.page === 0} onClick={() => move(at.page - 1)}>
          <CaretLeft size={18} className="rtl:rotate-180" />
        </RoundButton>
        <ul ref={list} className="no-scrollbar flex min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth py-1 motion-reduce:scroll-auto">
          {playlists.map((p) => (
            <li key={p.id} onContextMenu={onMenu(() => playlistMenu(p))} className="shrink-0 snap-start">
              <button onClick={() => open(p)} aria-label={p.name} className="group relative block h-[140px] w-[280px] overflow-hidden rounded-2xl bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent phone:w-[240px]">
                <Face p={p} />
              </button>
            </li>
          ))}
        </ul>
        <RoundButton label={tr('Show next playlists')} kind="plain" disabled={at.page >= at.pages - 1} onClick={() => move(at.page + 1)}>
          <CaretRight size={18} className="rtl:rotate-180" />
        </RoundButton>
      </div>
      {at.pages > 1 && (
        <div role="group" aria-label={tr('Pages')} className="flex justify-center gap-1.5">
          {Array.from({ length: at.pages }, (_, i) => (
            <button key={i} aria-label={tr('Page {n} of {total}', { n: i + 1, total: at.pages })} aria-current={i === at.page ? 'true' : undefined} onClick={() => move(i)} className={`size-2 rounded-full transition ${i === at.page ? 'bg-ink' : 'bg-line hover:bg-ink-3'}`} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * What a playlist page's header is drawn on (PageHeader `backdrop`): the wall of its covers under a wash that is deepest on the
 * text's side, mirrored in right-to-left. The header keeps its own height and content; its text goes white over this.
 */
export function PlaylistBackdrop({ p }: { p: LibraryPlaylist }) {
  const { arts, wash } = useBanner(p, 'start')
  return (
    <>
      <Wall arts={arts} rows={4} />
      <span aria-hidden className="absolute inset-0 rtl:-scale-x-100" style={{ background: wash }} />
    </>
  )
}

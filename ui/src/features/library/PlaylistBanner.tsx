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
import { bannerCovers, byIdOf, initialOf, pageOf, washOf } from './banner'

/** Playlists as banners (Settings › Appearance › Lists and navigation › Playlists as banners; loaded when used, not at launch): a tile of tilted strips of the playlist's covers under a colour taken from them, its name over it. Covers come through the `art` scheme, nothing from the network. */

/** The covers of a playlist and the wash over them (the first cover's colour; the name's hue until it is read, or without a cover). */
function useBanner(p: LibraryPlaylist) {
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
  return { arts, wash: washOf(rgb, p.name, dark) }
}

/** The strips: slanted bars side by side, each holding a cover the other way round so the picture stays upright, the whole set tilted with a little perspective (mirrored in right-to-left). Decorative: the name is the label. */
function Collage({ arts, size }: { arts: string[]; size: number }) {
  return (
    <span aria-hidden className="absolute inset-0 overflow-hidden [perspective:700px]">
      <span className="absolute -inset-x-[18%] -inset-y-[45%] flex [transform:rotateX(10deg)_rotate(-16deg)] rtl:[transform:rotateX(10deg)_rotate(16deg)] motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105">
        {arts.map((a) => (
          <span key={a} className="mx-px flex-1 skew-x-[-16deg] overflow-hidden">
            <img src={sizedArt(a, size / 2, window.devicePixelRatio || 1)} alt="" draggable={false} loading="lazy" decoding="async" className="size-full skew-x-[16deg] scale-150 object-cover" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
          </span>
        ))}
      </span>
    </span>
  )
}

/** One banner: the collage (or, without covers, the plain wash and the name's first letter), the wash, the name in white capitals. */
function Face({ p, tall }: { p: LibraryPlaylist; tall?: boolean }) {
  const { arts, wash } = useBanner(p)
  return (
    <>
      <Collage arts={arts} size={tall ? 700 : 320} />
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

/** The band above a playlist page's title: the same banner, wide. Decorative (the page's own title names the playlist). */
export function BannerHeader({ p }: { p: LibraryPlaylist }) {
  return (
    <div aria-hidden className="group relative mb-4 h-36 overflow-hidden rounded-2xl bg-raised">
      <Face p={p} tall />
    </div>
  )
}

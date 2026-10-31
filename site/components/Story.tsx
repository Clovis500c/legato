'use client'

import { motion, useMotionValue, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import dark from '@/assets/app-dark.png'
import light from '@/assets/app-light.png'
import { CHAPTERS } from './content'
import { Hero } from './Hero'

// The app's first window (tauri.conf.json); the stage scales it.
const APP = { w: 1360, h: 860 }
const PINNED = '(min-width: 1000px) and (prefers-reduced-motion: no-preference)'

/** Where the window stands: x, y from the stage's middle (share of it), degrees, zoom on the fitted size. */
type Pose = { x: number; y: number; rx: number; ry: number; zoom: number }

const HERO_POSE: Pose = { x: 0.3, y: 0.14, rx: 7, ry: -24, zoom: 0.92 }
const STAGES: { scene: string; pose: Pose }[] = [{ scene: 'library', pose: HERO_POSE }, ...CHAPTERS]

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** at = stage number, in fractions: each stage holds around its number, the window travels between. */
function poseAt(at: number): Pose {
  const i = Math.min(Math.floor(at), STAGES.length - 2)
  const t = smooth(clamp((at - i - 0.25) / 0.5))
  const [a, b] = [STAGES[i].pose, STAGES[i + 1].pose]
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), rx: mix(a.rx, b.rx, t), ry: mix(a.ry, b.ry, t), zoom: mix(a.zoom, b.zoom, t) }
}

function usePinned() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const media = matchMedia(PINNED)
    const read = () => setOn(media.matches)
    read()
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])
  return on
}

/** The app's picture: before the demo, instead of it when it fails, and on phones. */
function Still({ className = '' }: { className?: string }) {
  return (
    <picture>
      <source srcSet={dark.src} media="(prefers-color-scheme: dark)" />
      <img src={light.src} width={1128} height={640} alt="Legato's Songs page: your library on the left, songs from YouTube Music, Spotify, Apple Music and your folders in one list, Up next on the right." className={className} />
    </picture>
  )
}

/** The real interface in its frame. Waits for the page to be up; `ready` from the demo shows it over the picture. */
function Demo({ at }: { at: MotionValue<number> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [wanted, setWanted] = useState(false)
  const [ready, setReady] = useState(false)
  const last = useRef('')

  const send = (a: number) => {
    const i = Math.round(a)
    const message = { legato: 'scene', name: STAGES[i].scene, p: Math.round(clamp((a - i + 0.25) / 0.45) * 100) / 100 }
    const said = JSON.stringify(message)
    if (said === last.current) return
    last.current = said
    frame.current?.contentWindow?.postMessage(message, location.origin)
  }
  useMotionValueEvent(at, 'change', (a) => ready && send(a))

  useEffect(() => {
    const start = () => (window.requestIdleCallback ?? setTimeout)(() => setWanted(true))
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    const onMessage = (e: MessageEvent<{ legato?: string }>) => {
      if (e.origin !== location.origin || e.data.legato !== 'ready') return
      setReady(true)
      last.current = ''
      send(at.get())
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return wanted ? <iframe ref={frame} src="demo/index.html" title="Legato's interface" tabIndex={-1} inert className={`pointer-events-none absolute inset-0 size-full border-0 transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`} /> : null
}

/** The window: one transform, from the scroll and the stage's size. */
function AppWindow({ at }: { at: MotionValue<number> }) {
  const box = useRef<HTMLDivElement>(null)
  const w = useMotionValue(1440)
  const h = useMotionValue(900)
  useEffect(() => {
    const stage = box.current?.parentElement
    if (!stage) return
    const read = () => {
      w.set(stage.clientWidth)
      h.set(stage.clientHeight)
    }
    read()
    const watch = new ResizeObserver(read)
    watch.observe(stage)
    return () => watch.disconnect()
  }, [w, h])
  const transform = useTransform(() => {
    const p = poseAt(at.get())
    const fit = Math.min((w.get() * 0.66) / APP.w, (h.get() * 0.84) / APP.h)
    return `translate3d(${p.x * w.get()}px, ${p.y * h.get()}px, 0) rotateX(${p.rx}deg) rotateY(${p.ry}deg) scale(${fit * p.zoom})`
  })
  return (
    <motion.div ref={box} aria-hidden style={{ transform, width: APP.w, height: APP.h, marginLeft: -APP.w / 2, marginTop: -APP.h / 2 }} className="absolute top-1/2 left-1/2 overflow-hidden rounded-[10px] bg-panel shadow-(--shot-shadow) outline outline-line">
      <Still className="absolute inset-0 size-full object-cover object-left-top" />
      <Demo at={at} />
    </motion.div>
  )
}

/** One stage's text: there while the window holds, gone while it travels. Hidden once out, so Tab skips it. */
function Panel({ i, at, pinned, children }: { i: number; at: MotionValue<number>; pinned: boolean; children: ReactNode }) {
  const opacity = useTransform(at, (a) => 1 - clamp((Math.abs(a - i) - 0.22) / 0.14))
  const y = useTransform(at, (a) => (i - a) * 56)
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? 'hidden' : 'visible'))
  return (
    <motion.article style={pinned ? { opacity, y, visibility } : undefined} className={`pinned:absolute pinned:inset-y-0 pinned:left-(--pad) pinned:flex pinned:w-[min(40vw,620px)] pinned:flex-col pinned:justify-center ${i ? 'pinned:opacity-0' : ''}`}>
      {children}
    </motion.article>
  )
}

/** The scroll story: the window stays on screen, each chapter turns it and shows a real screen. Native scroll, sticky stage. */
export function Story() {
  const section = useRef<HTMLElement>(null)
  const pinned = usePinned()
  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end end'] })
  const at = useTransform(scrollYProgress, [0, 1], [0, STAGES.length - 1])
  return (
    <section ref={section} style={{ ['--stages' as string]: STAGES.length - 1 }} className="pinned:-mt-[78px] pinned:h-[calc(100svh+var(--stages)*130svh)]">
      <div style={pinned ? { perspective: 1800 } : undefined} className="pinned:sticky pinned:top-0 pinned:h-svh pinned:overflow-hidden">
        {pinned && <AppWindow at={at} />}
        <Panel i={0} at={at} pinned={pinned}>
          <Hero />
          <Still className="block h-auto w-full px-(--pad) pinned:hidden" />
        </Panel>
        {CHAPTERS.map(({ scene, title, text }, n) => (
          <Panel key={scene} i={n + 1} at={at} pinned={pinned}>
            <div className="px-(--pad) py-10 pinned:max-w-[min(34vw,500px)] pinned:p-0">
              <h2 className="text-[clamp(32px,3.9vw,56px)] leading-[1.07] font-black tracking-[-0.015em]">{title}</h2>
              <p className="mt-4 max-w-[440px] text-[clamp(16px,1.3vw,18px)] leading-[1.45] text-ink-2">{text}</p>
            </div>
            <Still className="block h-auto w-full px-(--pad) pinned:hidden" />
          </Panel>
        ))}
      </div>
    </section>
  )
}

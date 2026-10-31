'use client'

import { ArrowRight, SpeakerHigh, WindowsLogo } from '@phosphor-icons/react'
import { animate, motion, useMotionValue, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { CHAPTERS, type Pose } from './content'
import { Hero } from './Hero'
import { useLatest } from './latest'
import { EASE } from './motion'

// The app's first window (tauri.conf.json); the stage scales it.
const APP = { w: 1360, h: 860 }
const PINNED = '(min-width: 1000px) and (prefers-reduced-motion: no-preference)'

const HERO_POSE: Pose = { x: 0.3, y: 0.14, rx: 7, ry: -24, zoom: 0.92 }
const STAGES: { scene: string; pose: Pose }[] = [{ scene: 'library', pose: HERO_POSE }, ...CHAPTERS]
const LAST = CHAPTERS.length
// The last stage has no next one to scroll into: room for its screen to finish.
const TAIL = 0.25
const BLACK = STAGES.findIndex((s) => 'black' in s)

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
/** How dark the page is: full while the visualizer holds. */
const shade = (at: number) => 1 - clamp((Math.abs(at - BLACK) - 0.3) / 0.2)

/** at = stage number, in fractions: each stage holds around its number, the window travels between. */
function poseAt(at: number): Pose {
  const i = Math.min(Math.floor(at), LAST - 1)
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

/** A chapter's picture: before the demo, instead of it when it fails, on phones and with animations off. */
function Still({ name, alt, lazy, className = '' }: { name: string; alt: string; lazy?: boolean; className?: string }) {
  return (
    <picture>
      <source srcSet={`shots/${name}-dark.webp`} media="(prefers-color-scheme: dark)" />
      <img src={`shots/${name}-light.webp`} width={APP.w} height={APP.h} alt={alt} loading={lazy ? 'lazy' : undefined} className={className} />
    </picture>
  )
}

/** The real interface in its frame. Waits for the page to be up; `ready` from the demo shows it over the picture. `live`: the visitor's. */
function Demo({ at, live, onLeave }: { at: MotionValue<number>; live: boolean; onLeave: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [wanted, setWanted] = useState(false)
  const [ready, setReady] = useState(false)
  const last = useRef('')
  const seen = useRef(true)
  const taken = useRef(false)

  const say = (message: object) => frame.current?.contentWindow?.postMessage(message, location.origin)
  const send = (a: number) => {
    const i = Math.round(Math.min(a, LAST))
    const message = seen.current ? { legato: 'scene', name: STAGES[i].scene, p: Math.round(clamp((a - i + 0.25) / 0.45) * 100) / 100 } : { legato: 'scene', name: 'rest', p: 0 }
    const said = JSON.stringify(message)
    if (said === last.current) return
    last.current = said
    say(message)
  }
  useMotionValueEvent(at, 'change', (a) => ready && send(a))

  useEffect(() => {
    const start = () => (window.requestIdleCallback ?? setTimeout)(() => setWanted(true))
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    const onMessage = (e: MessageEvent<{ legato?: string }>) => {
      if (e.origin !== location.origin) return
      if (e.data.legato === 'leave') onLeave()
      if (e.data.legato !== 'ready') return
      setReady(true)
      last.current = ''
      send(at.get())
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Out of view: the song stops, and the visitor's turn with it.
  useEffect(() => {
    const story = frame.current?.closest('section')
    if (!ready || !story) return
    const watch = new IntersectionObserver(([e]) => {
      seen.current = e.isIntersecting
      if (!seen.current) onLeave()
      send(at.get())
    })
    watch.observe(story)
    return () => watch.disconnect()
  }, [ready])

  useEffect(() => {
    if (live) {
      say({ legato: 'take' })
      frame.current?.focus()
    } else if (taken.current) {
      say({ legato: 'give' })
      last.current = ''
      send(at.get())
    }
    taken.current = live
  }, [live])

  if (!wanted) return null
  return <iframe ref={frame} src="demo/index.html" title="Legato's interface" tabIndex={live ? 0 : -1} inert={!live} className={`absolute inset-0 size-full border-0 transition-opacity duration-300 ${live ? '' : 'pointer-events-none'} ${ready ? 'opacity-100' : 'opacity-0'}`} />
}

/** The window: one transform, from the scroll, the stage's size and the visitor's turn. */
function AppWindow({ at, take, live, onLeave }: { at: MotionValue<number>; take: MotionValue<number>; live: boolean; onLeave: () => void }) {
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
    const t = take.get()
    const fit = Math.min((w.get() * 0.66) / APP.w, (h.get() * 0.84) / APP.h) * p.zoom
    const full = Math.min((w.get() * 0.94) / APP.w, (h.get() * 0.82) / APP.h)
    return `translate3d(${mix(p.x, 0, t) * w.get()}px, ${mix(p.y, 0.005, t) * h.get()}px, 0) rotateX(${mix(p.rx, 0, t)}deg) rotateY(${mix(p.ry, 0, t)}deg) scale(${mix(fit, full, t)})`
  })
  return (
    <motion.div ref={box} aria-hidden={!live} style={{ transform, width: APP.w, height: APP.h, marginLeft: -APP.w / 2, marginTop: -APP.h / 2 }} className="absolute top-1/2 left-1/2 overflow-hidden rounded-[10px] bg-panel shadow-(--shot-shadow) outline outline-line">
      <Still name="library" alt="" className="absolute inset-0 size-full" />
      <Demo at={at} live={live} onLeave={onLeave} />
    </motion.div>
  )
}

/** One stage's text: there while the window holds, gone while it travels. Hidden once out, so Tab skips it. */
function Panel({ i, at, take, pinned, right, children }: { i: number; at: MotionValue<number>; take: MotionValue<number>; pinned: boolean; right?: boolean; children: ReactNode }) {
  const here = (a: number) => (i === LAST ? Math.min(a, i) : a)
  const opacity = useTransform(() => (1 - clamp((Math.abs(here(at.get()) - i) - 0.22) / 0.14)) * (1 - take.get()))
  const y = useTransform(at, (a) => (i - here(a)) * 56)
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? 'hidden' : 'visible'))
  const spot = !i ? 'pinned:left-(--pad) pinned:w-[min(40vw,620px)]' : right ? 'pinned:right-(--pad) pinned:w-[min(27vw,460px)] pinned:opacity-0' : 'pinned:left-(--pad) pinned:w-[min(27vw,460px)] pinned:opacity-0'
  return (
    <motion.article style={pinned ? { opacity, y, visibility } : undefined} className={`pinned:absolute pinned:inset-y-0 pinned:flex pinned:flex-col pinned:justify-center ${spot}`}>
      {children}
    </motion.article>
  )
}

/** Fills as the visitor goes through its chapter. */
function Segment({ i, at }: { i: number; at: MotionValue<number> }) {
  const scaleX = useTransform(at, [i - 0.5, i === LAST ? i + 0.2 : i + 0.5], [0, 1])
  return (
    <span className="block h-[3px] w-full overflow-hidden rounded-full bg-line">
      <motion.span style={{ scaleX }} className="block h-full origin-left bg-ink" />
    </span>
  )
}

/** The page's own player bar: what's playing is the chapter, Up next the next one, the scrubber jumps between them. */
function ChapterBar({ at, taken, onBack }: { at: MotionValue<number>; taken: boolean; onBack: () => void }) {
  const [now, setNow] = useState(1)
  useMotionValueEvent(at, 'change', (a) => setNow(Math.max(1, Math.round(Math.min(a, LAST)))))
  const opacity = useTransform(at, [0.3, 0.5], [0, 1])
  const next = CHAPTERS[now]
  return (
    <motion.div style={{ opacity }} className="absolute inset-x-0 bottom-0 flex h-14 items-center gap-6 border-t border-line bg-bg px-(--pad) text-[13px] transition-colors duration-200 focus-within:opacity-100!">
      {taken ? (
        <>
          <p className="min-w-0 flex-1 truncate text-ink-2">Legato's real interface, with invented songs and no sound.</p>
          <button onClick={onBack} className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2 font-medium text-on-ink">
            Back to the page <kbd className="font-sans opacity-70">Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <p className="flex min-w-0 flex-1 items-center gap-2.5 font-medium">
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-on-accent">
              <SpeakerHigh size={14} weight="fill" />
            </span>
            <span className="truncate">{CHAPTERS[now - 1].title}</span>
          </p>
          <nav aria-label="Chapters" className="flex w-[min(34vw,460px)] gap-1">
            {CHAPTERS.map(({ scene, title }, n) => (
              <a key={scene} href={`#chapter-${scene}`} aria-label={title} title={title} aria-current={now === n + 1 ? 'step' : undefined} className="flex h-8 flex-1 items-center">
                <Segment i={n + 1} at={at} />
              </a>
            ))}
          </nav>
          <p className="min-w-0 flex-1 truncate text-right text-ink-2">{next && <>Up next: {next.title}</>}</p>
        </>
      )}
    </motion.div>
  )
}

/** The last chapter's way out: the window itself if it's here, the installer always. */
function Actions({ pinned, onTake, button }: { pinned: boolean; onTake: () => void; button: RefObject<HTMLButtonElement | null> }) {
  const { href } = useLatest()
  const pill = 'inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-medium'
  return (
    <>
      {pinned && <p className="mt-4 text-[clamp(16px,1.3vw,18px)] leading-[1.45] text-ink-2">That window is the real interface, with invented songs and no sound.</p>}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        {pinned && (
          <button ref={button} onClick={onTake} className={`${pill} cursor-pointer bg-ink text-on-ink`}>
            Try it here <ArrowRight size={16} />
          </button>
        )}
        <a href={href} className={pinned ? 'inline-flex items-center gap-2 text-[15px] font-medium' : `${pill} bg-ink text-on-ink`}>
          <WindowsLogo size={18} weight="fill" /> Download for Windows
        </a>
      </div>
    </>
  )
}

/** The scroll story: the window stays on screen, each chapter turns it and shows a real screen. Native scroll, sticky stage. */
export function Story() {
  const section = useRef<HTMLElement>(null)
  const tryIt = useRef<HTMLButtonElement>(null)
  const pinned = usePinned()
  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end end'] })
  const at = useTransform(scrollYProgress, [0, 1], [0, LAST + TAIL])
  const night = useTransform(at, shade)
  const zIndex = useTransform(night, (d) => (d > 0 ? 30 : 0))
  const [black, setBlack] = useState(false)
  useMotionValueEvent(night, 'change', (d) => setBlack(d > 0.5))

  // The visitor's turn: the window comes flat and takes the stage, until they leave or scroll away.
  const [taken, setTaken] = useState(false)
  const take = useMotionValue(0)
  const back = () => setTaken(false)
  useMotionValueEvent(at, 'change', (a) => a < LAST - 0.3 && back())
  useEffect(() => {
    const done = animate(take, taken ? 1 : 0, { duration: 0.5, ease: EASE })
    if (!taken) void done.then(() => tryIt.current?.focus({ preventScroll: true }))
    if (!taken) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && back()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [taken])
  useEffect(() => {
    if (!pinned) back()
  }, [pinned])

  return (
    <section ref={section} style={{ ['--stages' as string]: LAST + TAIL }} className="pinned:relative pinned:-mt-[78px] pinned:h-[calc(100svh+var(--stages)*130svh)]">
      {pinned && CHAPTERS.map(({ scene }, n) => <span key={scene} id={`chapter-${scene}`} style={{ top: `${(n + 1) * 130}svh` }} className="absolute" />)}
      <motion.div data-black={black || undefined} style={pinned ? { perspective: 1800, zIndex } : undefined} className="text-ink pinned:sticky pinned:top-0 pinned:h-svh pinned:overflow-hidden">
        {pinned && <motion.div aria-hidden style={{ opacity: night }} className="absolute inset-0 bg-[#131313]" />}
        {pinned && <AppWindow at={at} take={take} live={taken} onLeave={back} />}
        <Panel i={0} at={at} take={take} pinned={pinned}>
          <Hero />
          <Still name="library" alt={CHAPTERS[0].alt} className="block h-auto w-full px-(--pad) pinned:hidden" />
        </Panel>
        {CHAPTERS.map(({ scene, title, text, alt, pose }, n) => (
          <Panel key={scene} i={n + 1} at={at} take={take} pinned={pinned} right={pose.x < 0}>
            <div className="px-(--pad) py-10 pinned:p-0">
              <h2 className="text-[clamp(32px,3.9vw,56px)] leading-[1.07] font-black tracking-[-0.015em]">{title}</h2>
              <p className="mt-4 max-w-[440px] text-[clamp(16px,1.3vw,18px)] leading-[1.45] text-ink-2">{text}</p>
              {n + 1 === LAST && <Actions pinned={pinned} onTake={() => setTaken(true)} button={tryIt} />}
            </div>
            {n > 0 && <Still name={scene} alt={alt} lazy className="block h-auto w-full px-(--pad) pinned:hidden" />}
          </Panel>
        ))}
        {pinned && <ChapterBar at={at} taken={taken} onBack={back} />}
      </motion.div>
    </section>
  )
}

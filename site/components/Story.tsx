'use client'

import { AndroidLogo, ArrowRight, SpeakerHigh, WindowsLogo } from '@phosphor-icons/react'
import { animate, motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { CHAPTERS, type Pose } from './content'
import { Hero } from './Hero'
import { useAndroid, useLatest } from './latest'
import { EASE } from './motion'

// The app's first window (tauri.conf.json); the stage scales it.
const APP = { w: 1360, h: 860 }
// The phone's screen: under 640 px wide, ui/ takes its own phone layout. RIM: the phone's edge around it.
const PHONE = { w: 375, h: 812 }
const RIM = 9
const DEVICE = { w: PHONE.w + 2 * RIM, h: PHONE.h + 2 * RIM }
// The phone's stage: the chapter bar's height, the room between a chapter's text and the phone.
const BAR = 44
const GAP = 16
const PINNED = '(min-width: 1000px) and (prefers-reduced-motion: no-preference)'
const POCKET = '(width < 1000px) and (prefers-reduced-motion: no-preference)'
// Animations off: chapters stack, each with its picture (the phone's screen under 1000 px).
const STACKED = 'mx-(--pad) block h-auto w-[calc(100%-2*var(--pad))] max-w-[880px] rounded-lg outline outline-line story:hidden max-[1000px]:mx-auto max-[1000px]:w-[min(300px,72vw)] max-[1000px]:rounded-[28px]'

const HERO_POSE: Pose = { x: 0.3, y: 0.14, rx: 7, ry: -24, zoom: 0.92 }
const STAGES: { scene: string; pose: Pose }[] = [{ scene: 'library', pose: HERO_POSE }, ...CHAPTERS]
// The phone's poses: less tilt than the window's, always under the text ([rotateX, rotateY]). Its hero: tipped back, its top
// under the headline.
const TILT: Record<string, [number, number]> = { library: [5, -8], import: [3, 7], search: [4, -6], player: [2, 8], karaoke: [0, -4], visualizer: [0, 0], editor: [3, 6], themes: [0, -3] }
const PHONE_POSES: Pose[] = [{ x: 0.03, y: 0, rx: 24, ry: -12, zoom: 1.1 }, ...CHAPTERS.map(({ scene }) => ({ x: 0, y: 0, rx: TILT[scene]?.[0] ?? 0, ry: TILT[scene]?.[1] ?? 0, zoom: 1 }))]
const LAST = CHAPTERS.length
// The last stage has no next one to scroll into: room for its screen to finish.
const TAIL = 0.25
const BLACK = STAGES.findIndex((s) => 'black' in s)

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
/** How dark the page is: full while the visualizer holds. */
const shade = (at: number) => 1 - clamp((Math.abs(at - BLACK) - 0.3) / 0.2)
/** Between stage i and the next: 0 while i holds, 1 once the next one does. */
const step = (at: number) => {
  const i = Math.min(Math.floor(at), LAST - 1)
  return [i, smooth(clamp((at - i - 0.25) / 0.5))] as const
}

/** at = stage number, in fractions: each stage holds around its number, the window travels between. */
function poseAt(at: number): Pose {
  const [i, t] = step(at)
  const [a, b] = [STAGES[i].pose, STAGES[i + 1].pose]
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), rx: mix(a.rx, b.rx, t), ry: mix(a.ry, b.ry, t), zoom: mix(a.zoom, b.zoom, t) }
}

type Stand = { x: number; y: number; s: number; rx: number; ry: number }

/** Where the phone stands at stage i: as big as the room under the stage's text (`tops`: each text's bottom). */
function standAt(i: number, w: number, h: number, tops: number[]): Stand {
  const pose = PHONE_POSES[i]
  const top = (k: number) => (tops[k] ?? h * 0.3) + GAP
  const fit = (k: number) => Math.max(0.2, Math.min((h - BAR - GAP - top(k)) / DEVICE.h, (w * 0.8) / DEVICE.w))
  // The hero's text is tall: the first chapter's size, its top under the headline, the rest below the fold.
  const s = fit(Math.max(i, 1)) * pose.zoom
  const y = i ? top(i) + (h - BAR - GAP - top(i)) / 2 : top(0) + (DEVICE.h * s) / 2
  return { x: w / 2 + pose.x * w, y, s, rx: pose.rx, ry: pose.ry }
}

function useMode(): 'pc' | 'phone' | null {
  const [mode, setMode] = useState<'pc' | 'phone' | null>(null)
  useEffect(() => {
    const pc = matchMedia(PINNED)
    const phone = matchMedia(POCKET)
    const read = () => setMode(pc.matches ? 'pc' : phone.matches ? 'phone' : null)
    read()
    pc.addEventListener('change', read)
    phone.addEventListener('change', read)
    return () => {
      pc.removeEventListener('change', read)
      phone.removeEventListener('change', read)
    }
  }, [])
  return mode
}

/** Frames a second over `ms`: the page's own thread, which the demo shares. */
const fps = (ms: number) =>
  new Promise<number>((done) => {
    let n = 0
    let first = 0
    const tick = (t: number) => {
      first ||= t
      if (t - first >= ms) return done((n * 1000) / (t - first))
      n++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

/** A chapter's picture in the window or the phone: before the demo, and instead of it when it fails. */
function Still({ name, alt, phone, className = '' }: { name: string; alt: string; phone?: boolean; className?: string }) {
  const [file, w, h] = phone ? [`${name}-phone`, PHONE.w, PHONE.h] : [name, APP.w, APP.h]
  return (
    <picture>
      <source srcSet={`shots/${file}-dark.webp`} media="(prefers-color-scheme: dark)" />
      <img src={`shots/${file}-light.webp`} width={w} height={h} alt={alt} className={className} />
    </picture>
  )
}

/** A chapter's picture where chapters stack (animations off): the phone's screen under 1000 px, the window above. */
function Stacked({ name, alt, lazy }: { name: string; alt: string; lazy?: boolean }) {
  return (
    <picture>
      <source media="(width < 1000px) and (prefers-color-scheme: dark)" srcSet={`shots/${name}-phone-dark.webp`} width={PHONE.w} height={PHONE.h} />
      <source media="(width < 1000px)" srcSet={`shots/${name}-phone-light.webp`} width={PHONE.w} height={PHONE.h} />
      <source media="(prefers-color-scheme: dark)" srcSet={`shots/${name}-dark.webp`} />
      <img src={`shots/${name}-light.webp`} width={APP.w} height={APP.h} alt={alt} loading={lazy ? 'lazy' : undefined} className={STACKED} />
    </picture>
  )
}

/**
 * The real interface in its frame. Waits for the page to be up; `ready` from the demo shows it over the picture. `live`:
 * the visitor's. On a phone: only once the visitor scrolls, never with Save-Data, and dropped (`onFail`) when the page
 * runs under 20 frames a second once it has settled.
 */
function Demo({ at, ready, live, phone, onReady, onLeave, onFail }: { at: MotionValue<number>; ready: boolean; live: boolean; phone?: boolean; onReady: () => void; onLeave: () => void; onFail?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [wanted, setWanted] = useState(false)
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
    if (phone && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
    const start = () => (window.requestIdleCallback ?? setTimeout)(() => setWanted(true))
    // A phone's first screen loads alone: the demo waits for the visitor's first scroll.
    const begin = phone ? () => window.addEventListener('scroll', start, { once: true, passive: true }) : start
    if (document.readyState === 'complete') begin()
    else window.addEventListener('load', begin, { once: true })
    const onMessage = (e: MessageEvent<{ legato?: string }>) => {
      if (e.origin !== location.origin) return
      if (e.data.legato === 'leave') onLeave()
      if (e.data.legato !== 'ready') return
      onReady()
      last.current = ''
      send(at.get())
      // Its first scene settled, then two seconds of frames. Under 3 a second the page isn't painted (out of sight), not slow.
      if (phone) setTimeout(() => void fps(2000).then((f) => f >= 3 && f < 20 && !document.hidden && onFail?.()), 1000)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('scroll', start)
      window.removeEventListener('message', onMessage)
    }
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

/** The stage's size, read as it changes. */
function useStage(box: RefObject<HTMLDivElement | null>, w0: number, h0: number) {
  const w = useMotionValue(w0)
  const h = useMotionValue(h0)
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
  }, [w, h, box])
  return [w, h] as const
}

type WindowProps = { at: MotionValue<number>; take: MotionValue<number>; ready: boolean; live: boolean; onReady: () => void; onLeave: () => void }

/** The window: one transform, from the scroll, the stage's size and the visitor's turn. No demo: each chapter's picture. */
function AppWindow({ at, take, ready, live, onReady, onLeave }: WindowProps) {
  const box = useRef<HTMLDivElement>(null)
  const [still, setStill] = useState('library')
  useMotionValueEvent(at, 'change', (a) => ready || setStill(STAGES[Math.round(Math.min(a, LAST))].scene))
  const [w, h] = useStage(box, 1440, 900)
  // Its own layer while it moves: no repaint of the interface each frame. Dropped at rest, so a zoom above 1 is sharp again.
  const willChange = useMotionValue('auto')
  useMotionValueEvent(at, 'animationStart', () => willChange.set('transform'))
  useMotionValueEvent(at, 'animationComplete', () => willChange.set('auto'))
  const transform = useTransform(() => {
    const p = poseAt(at.get())
    const t = take.get()
    const fit = Math.min((w.get() * 0.66) / APP.w, (h.get() * 0.84) / APP.h) * p.zoom
    const full = Math.min((w.get() * 0.94) / APP.w, (h.get() * 0.82) / APP.h)
    return `translate3d(${mix(p.x, 0, t) * w.get()}px, ${mix(p.y, 0.005, t) * h.get()}px, 0) rotateX(${mix(p.rx, 0, t)}deg) rotateY(${mix(p.ry, 0, t)}deg) scale(${mix(fit, full, t)})`
  })
  return (
    <motion.div ref={box} aria-hidden={!live} style={{ transform, willChange, width: APP.w, height: APP.h, marginLeft: -APP.w / 2, marginTop: -APP.h / 2 }} className="absolute top-1/2 left-1/2 overflow-hidden rounded-[10px] bg-panel shadow-(--shot-shadow) outline outline-line">
      <Still name={still} alt="" className="absolute inset-0 size-full" />
      <Demo at={at} ready={ready} live={live} onReady={onReady} onLeave={onLeave} />
    </motion.div>
  )
}

/**
 * The phone: its screen a phone's size, so the interface takes its phone layout, under each chapter's text. Taken, it
 * fades through to the interface at the stage's own size, the phone's edge gone: a phone's real taps, a real phone's size.
 */
function PhoneWindow({ at, take, ready, live, failed, tops, onReady, onLeave, onFail }: WindowProps & { failed: boolean; tops: MotionValue<number[]>; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [still, setStill] = useState('library')
  useMotionValueEvent(at, 'change', (a) => ready || setStill(STAGES[Math.round(Math.min(a, LAST))].scene))
  const [w, h] = useStage(box, 390, 760)
  const [flat, setFlat] = useState(false)
  useMotionValueEvent(take, 'change', (t) => setFlat(t >= 0.5))
  const opacity = useTransform(take, (t) => Math.abs(1 - 2 * t))
  const transform = useTransform(() => {
    if (take.get() >= 0.5) return 'none'
    const [i, t] = step(at.get())
    const [a, b] = [standAt(i, w.get(), h.get(), tops.get()), standAt(i + 1, w.get(), h.get(), tops.get())]
    const x = mix(a.x, b.x, t) - DEVICE.w / 2
    const y = mix(a.y, b.y, t) - DEVICE.h / 2
    return `translate3d(${x}px, ${y}px, 0) rotateX(${mix(a.rx, b.rx, t)}deg) rotateY(${mix(a.ry, b.ry, t)}deg) scale(${mix(a.s, b.s, t)})`
  })
  return (
    <motion.div
      ref={box}
      aria-hidden={!live}
      style={{ transform, opacity, ...(flat ? { width: '100%', height: `calc(100% - ${BAR}px)` } : { width: DEVICE.w, height: DEVICE.h }) }}
      className={`absolute top-0 left-0 ${flat ? '' : 'rounded-[52px] bg-[#0c0c0c] p-[9px] shadow-(--shot-shadow) outline outline-white/10 will-change-transform'}`}
    >
      <div className={`relative size-full overflow-hidden bg-panel ${flat ? '' : 'rounded-[43px]'}`}>
        <Still name={still} alt="" phone className="absolute inset-0 size-full" />
        {!failed && <Demo at={at} ready={ready} live={live} phone onReady={onReady} onLeave={onLeave} onFail={onFail} />}
      </div>
    </motion.div>
  )
}

/** One stage's text: there while the window holds, gone while it travels. Hidden once out, so Tab skips it. */
function Panel({ i, at, take, mode, right, tops, children }: { i: number; at: MotionValue<number>; take: MotionValue<number>; mode: 'pc' | 'phone' | null; right?: boolean; tops: MotionValue<number[]>; children: ReactNode }) {
  const own = useRef<HTMLElement>(null)
  const here = (a: number) => (i === LAST ? Math.min(a, i) : a)
  const opacity = useTransform(() => (1 - clamp((Math.abs(here(at.get()) - i) - 0.22) / 0.14)) * (1 - take.get()))
  const y = useTransform(at, (a) => (i - here(a)) * (mode === 'phone' ? 24 : 56))
  const visibility = useTransform(opacity, (o) => (o < 0.01 ? 'hidden' : 'visible'))
  // The phone stands under the text: where it ends.
  useEffect(() => {
    const el = own.current
    if (mode !== 'phone' || !el) return
    const read = () => {
      const all = [...tops.get()]
      all[i] = el.offsetTop + el.offsetHeight
      tops.set(all)
    }
    read()
    const watch = new ResizeObserver(read)
    watch.observe(el)
    return () => watch.disconnect()
  }, [mode, i, tops])
  const spot = !i ? 'pinned:left-(--pad) pinned:w-[min(40vw,620px)] pocket:pt-[78px]' : right ? 'pinned:right-(--pad) pinned:w-[min(27vw,460px)] story:opacity-0' : 'pinned:left-(--pad) pinned:w-[min(27vw,460px)] story:opacity-0'
  return (
    <motion.article ref={own} style={mode ? { opacity, y, visibility } : undefined} className={`pinned:absolute pinned:inset-y-0 pinned:flex pinned:flex-col pinned:justify-center pocket:absolute pocket:inset-x-0 pocket:top-0 ${spot}`}>
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

/** The page's own player bar: what's playing is the chapter, Up next the next one, the scrubber jumps between them. The phone's: the scrubber. */
function ChapterBar({ at, taken, onBack }: { at: MotionValue<number>; taken: boolean; onBack: () => void }) {
  const [now, setNow] = useState(1)
  useMotionValueEvent(at, 'change', (a) => setNow(Math.max(1, Math.round(Math.min(a, LAST)))))
  const opacity = useTransform(at, [0.3, 0.5], [0, 1])
  const next = CHAPTERS[now]
  return (
    <motion.div style={{ opacity }} className="absolute inset-x-0 bottom-0 flex h-14 items-center gap-6 border-t border-line bg-bg px-(--pad) text-[13px] transition-colors duration-200 focus-within:opacity-100! pocket:h-11 pocket:gap-3">
      {taken ? (
        <>
          <p className="min-w-0 flex-1 truncate text-ink-2 pocket:hidden">Legato's real interface, with invented songs and no sound.</p>
          <button onClick={onBack} className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2 font-medium text-on-ink pocket:mx-auto pocket:py-1.5">
            Back to the page <kbd className="font-sans opacity-70 pocket:hidden">Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <p className="flex min-w-0 flex-1 items-center gap-2.5 font-medium pocket:hidden">
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-on-accent">
              <SpeakerHigh size={14} weight="fill" />
            </span>
            <span className="truncate">{CHAPTERS[now - 1].title}</span>
          </p>
          <nav aria-label="Chapters" className="flex w-[min(34vw,460px)] gap-1 pocket:w-full">
            {CHAPTERS.map(({ scene, title }, n) => (
              <a key={scene} href={`#chapter-${scene}`} aria-label={title} title={title} aria-current={now === n + 1 ? 'step' : undefined} className="flex h-8 flex-1 items-center">
                <Segment i={n + 1} at={at} />
              </a>
            ))}
          </nav>
          <p className="min-w-0 flex-1 truncate text-right text-ink-2 pocket:hidden">{next && <>Up next: {next.title}</>}</p>
        </>
      )}
    </motion.div>
  )
}

/** The device reading the page, for the way out: Android gets the APK, an iPhone the Windows app and a word. */
function useDevice() {
  const [device, setDevice] = useState<'android' | 'iphone' | null>(null)
  useEffect(() => {
    const ua = navigator.userAgent
    setDevice(/Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iphone' : null)
  }, [])
  return device
}

/** The last chapter's way out: the window itself if the demo is up, the installer always (the APK on Android). */
function Actions({ ready, phone, onTake, button }: { ready: boolean; phone: boolean; onTake: () => void; button: RefObject<HTMLButtonElement | null> }) {
  const { href } = useLatest()
  const android = useAndroid()
  const device = useDevice()
  const pill = 'inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-medium'
  const get = ready ? 'inline-flex items-center gap-2 text-[15px] font-medium' : `${pill} bg-ink text-on-ink`
  return (
    <>
      {ready && <p className="mt-4 text-[clamp(16px,1.3vw,18px)] leading-[1.45] text-ink-2 pocket:mt-2 pocket:text-[15px]">That {phone ? 'phone' : 'window'} is the real interface, with invented songs and no sound.</p>}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 pocket:mt-4">
        {ready && (
          <button ref={button} onClick={onTake} className={`${pill} cursor-pointer bg-ink text-on-ink pocket:px-5 pocket:py-2.5`}>
            Try it here <ArrowRight size={16} />
          </button>
        )}
        {device === 'android' ? (
          <a href={android.href} className={get}>
            <AndroidLogo size={18} weight="fill" /> Get the Android app
          </a>
        ) : (
          <a href={href} className={get}>
            <WindowsLogo size={18} weight="fill" /> Download for Windows
          </a>
        )}
      </div>
      {device === 'iphone' && (
        <p className="mt-3 text-[13px] text-ink-3">
          No iPhone app yet:{' '}
          <a href="#faq" className="underline decoration-line underline-offset-4">
            the FAQ says more
          </a>
          .
        </p>
      )}
    </>
  )
}

/** The scroll story: the window stays on screen, each chapter turns it and shows a real screen. Native scroll, sticky stage. Under 1000 px, a phone. */
export function Story() {
  const section = useRef<HTMLElement>(null)
  const tryIt = useRef<HTMLButtonElement>(null)
  const mode = useMode()
  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end end'] })
  // The stage glides after the scroll: a wheel's notches and a dragged scrollbar arrive as one movement. No overshoot.
  const at = useSpring(useTransform(scrollYProgress, [0, 1], [0, LAST + TAIL]), { stiffness: 220, damping: 32, restDelta: 0.0005 })
  const night = useTransform(at, shade)
  const zIndex = useTransform(night, (d) => (d > 0 ? 30 : 0))
  const [black, setBlack] = useState(false)
  useMotionValueEvent(night, 'change', (d) => setBlack(d > 0.5))
  const tops = useMotionValue<number[]>([])

  // The visitor's turn: the window comes flat and takes the stage, until they leave or scroll away.
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [taken, setTaken] = useState(false)
  const take = useMotionValue(0)
  const back = () => setTaken(false)
  // The phone's chapters take the whole screen: the site's header steps aside while one holds. Written on a change only.
  const aside = useRef(false)
  useMotionValueEvent(at, 'change', (a) => {
    if (a < LAST - 0.3) back()
    const on = mode === 'phone' && a > 0.5 && a < LAST + TAIL - 0.02
    if (on === aside.current) return
    aside.current = on
    if (on) document.documentElement.dataset.story = 'phone'
    else delete document.documentElement.dataset.story
  })
  useEffect(() => {
    const done = animate(take, taken ? 1 : 0, { duration: 0.5, ease: EASE })
    if (!taken) void done.then(() => tryIt.current?.focus({ preventScroll: true }))
    if (!taken) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && back()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [taken])
  useEffect(() => {
    back()
    setReady(false)
    return () => {
      aside.current = false
      delete document.documentElement.dataset.story
    }
  }, [mode])

  const windowProps = { at, take, ready, live: taken, onReady: () => setReady(true), onLeave: back }
  return (
    <section ref={section} style={{ ['--stages' as string]: LAST + TAIL }} className="story:relative story:-mt-[78px] story:h-[calc(100svh+var(--stages)*130svh)]">
      {mode && CHAPTERS.map(({ scene }, n) => <span key={scene} id={`chapter-${scene}`} style={{ top: `${(n + 1) * 130}svh` }} className="absolute" />)}
      <motion.div data-black={black || undefined} style={mode ? { perspective: mode === 'phone' ? 900 : 1800, zIndex } : undefined} className="text-ink story:sticky story:top-0 story:h-svh story:overflow-hidden">
        {mode && <motion.div aria-hidden style={{ opacity: night }} className="absolute inset-0 bg-[#131313]" />}
        {mode === 'pc' && <AppWindow {...windowProps} />}
        {mode === 'phone' && (
          <PhoneWindow
            {...windowProps}
            failed={failed}
            tops={tops}
            onFail={() => {
              setFailed(true)
              setReady(false)
            }}
          />
        )}
        <Panel i={0} at={at} take={take} mode={mode} tops={tops}>
          <Hero />
          <Stacked name="library" alt={CHAPTERS[0].alt} />
        </Panel>
        {CHAPTERS.map(({ scene, title, text, alt, pose }, n) => (
          <Panel key={scene} i={n + 1} at={at} take={take} mode={mode} tops={tops} right={pose.x < 0}>
            <div className="px-(--pad) py-10 pinned:p-0 pocket:pt-5 pocket:pb-0">
              <h2 className="text-[clamp(32px,3.9vw,56px)] leading-[1.07] font-black tracking-[-0.015em] pocket:text-[clamp(26px,7vw,40px)]">{title}</h2>
              <p className="mt-4 max-w-[440px] text-[clamp(16px,1.3vw,18px)] leading-[1.45] text-ink-2 pocket:mt-2 pocket:max-w-[560px] pocket:text-[15px]">{text}</p>
              {n + 1 === LAST && <Actions ready={!!mode && ready} phone={mode === 'phone'} onTake={() => setTaken(true)} button={tryIt} />}
            </div>
            {n > 0 && <Stacked name={scene} alt={alt} lazy />}
          </Panel>
        ))}
        {mode && <ChapterBar at={at} taken={taken} onBack={back} />}
      </motion.div>
    </section>
  )
}

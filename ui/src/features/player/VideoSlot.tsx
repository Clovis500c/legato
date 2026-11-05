import { useLayoutEffect, useRef } from 'react'
import { usePip } from './pipMode'
import { useVideoSlot } from './store'

// Apart from Now Playing: the side panel, the mini player and the sidebar player hold it too, and Now Playing loads late.
/**
 * Publishes its rect so the single YouTube iframe sits here. YouTube rules: at least 200×200, nothing on top.
 * pip: picture-in-picture's own (pipMode.ts); while it shows, the other slots wait.
 */
export function VideoSlot({ className = '', style, hidden = false, fill = false, live = false, pip = false, onClick }: { className?: string; style?: React.CSSProperties; hidden?: boolean; fill?: boolean; live?: boolean; pip?: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = useVideoSlot((s) => s.set)
  const off = usePip((s) => s.on) !== pip
  useLayoutEffect(() => {
    if (off) return
    useVideoSlot.setState({ hidden, fill })
    return () => useVideoSlot.setState({ hidden: false, fill: false })
  }, [hidden, fill, off])
  // live: slot moves without resizing (mini player drag, snap animation): follow it every frame.
  useLayoutEffect(() => {
    if (!live || off) return
    let id = 0
    const tick = () => {
      set(ref.current!.getBoundingClientRect())
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [live, set, off])
  useLayoutEffect(() => {
    if (off) return
    const el = ref.current!
    const update = () => set(el.getBoundingClientRect())
    const ro = new ResizeObserver(update)
    // Ancestors too: the slot moves without resizing when its column narrows or widens (Up next opened / closed).
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) ro.observe(n)
    window.addEventListener('resize', update)
    // Capture: any scrolling ancestor moves the slot.
    window.addEventListener('scroll', update, true)
    // Now Playing rises in (np-in, 28 px): measured mid-animation, the video stayed low over the title. Again at its end.
    window.addEventListener('animationend', update, true)
    window.addEventListener('transitionend', update, true)
    update()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('animationend', update, true)
      window.removeEventListener('transitionend', update, true)
      set(null)
    }
  }, [set, off])
  // The iframe takes no pointer: clicks land here (our own play / pause, not YouTube's).
  return <div ref={ref} data-video-slot onClick={onClick} className={`rounded-lg bg-black ${onClick ? 'cursor-pointer' : ''} ${className}`} style={style} />
}

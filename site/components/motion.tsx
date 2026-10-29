'use client'

import { MotionConfig, motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'

/** The app's easing (ui/src/styles.css): quick out, soft landing. */
export const EASE = [0.2, 0.8, 0.2, 1] as const

/** Children of a `group` come in one after another once it scrolls into view. */
export const group: Variants = { show: { transition: { staggerChildren: 0.05 } } }
export const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}
/** Once, a little before it's fully in view. */
export const inView = { initial: 'hidden', whileInView: 'show', viewport: { once: true, margin: '0px 0px -8% 0px' } } as const

/** Windows' "Animation effects" off (prefers-reduced-motion): fades only, nothing moves. */
export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

/** A block that rises in when it scrolls into view. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div {...inView} variants={item} className={className}>
      {children}
    </motion.div>
  )
}

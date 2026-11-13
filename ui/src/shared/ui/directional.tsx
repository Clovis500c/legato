import { ArrowLeft as PhosphorArrowLeft, ArrowRight as PhosphorArrowRight, CaretLeft as PhosphorCaretLeft, CaretRight as PhosphorCaretRight, type Icon, type IconProps } from '@phosphor-icons/react'
import { forwardRef } from 'react'
import { isRtl, useLang } from '../i18n/i18n'

// Arrows and carets that point somewhere: turned around when the interface is written right to left. (Play, skip and the
// player's own controls keep their sides, as media controls do.)
const turning = (Inner: Icon): Icon =>
  forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    const rtl = useLang((s) => isRtl(s.lang))
    return <Inner ref={ref} {...props} mirrored={rtl} />
  })

export const ArrowLeft = turning(PhosphorArrowLeft)
export const ArrowRight = turning(PhosphorArrowRight)
export const CaretLeft = turning(PhosphorCaretLeft)
export const CaretRight = turning(PhosphorCaretRight)

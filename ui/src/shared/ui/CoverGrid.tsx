import { Cover } from './Cover'

/**
 * Four covers in a 2×2 square: fixed square tiles whatever each picture's shape (video frames cropped by `Cover`).
 * User's report 2026-10-22: auto-sized rows let wide thumbnails take more room than others.
 */
export function CoverGrid({ arts, size, framed = true, className = '' }: { arts: string[][]; size: number; framed?: boolean; className?: string }) {
  // Inside the 1 px border when framed.
  const tile = (framed ? size - 2 : size) / 2
  return (
    <span aria-hidden className={`grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden bg-recess ${framed ? 'rounded-cover border border-line-soft' : ''} ${className}`} style={{ width: size, height: size }}>
      {arts.slice(0, 4).map((art, i) => (
        <Cover key={i} title="" art={art} size={tile} className="rounded-none! border-0!" />
      ))}
    </span>
  )
}

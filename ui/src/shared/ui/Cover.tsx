/** Typographic sleeve until real artwork lands: flat tile, initials. Radius = user setting. */
export function Cover({ title, size = 38, className = '' }: { title: string; size?: number; className?: string }) {
  const initials = title
    .replace(/[([].*?[)\]]/g, '')
    .split(/\s+/)
    .filter((w) => /\p{L}|\d/u.test(w))
    .slice(0, 2)
    .map((w) => w.match(/[\p{L}\d]/u)![0])
    .join('')
    .toUpperCase()
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-cover border border-line-soft bg-recess font-mono font-semibold text-ink-3 ${className}`} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.3) }}>
      {initials || '♪'}
    </span>
  )
}

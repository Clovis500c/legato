import { useVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Grid of cards, virtualized by rows (Albums: tens of thousands at 50k songs used to take seconds to show). As many
 * columns of at least `min` px as fit; rows measured as they render.
 */
export function VirtualGrid<T>({ items, itemKey, render, min = 150, gapX = 20, gapY = 24, className = '' }: { items: T[]; itemKey: (t: T) => string; render: (t: T) => ReactNode; min?: number; gapX?: number; gapY?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = box.current!
    // Fires once on observe too.
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cols = Math.max(1, Math.floor((width + gapX) / (min + gapX)))
  const cell = width ? (width - gapX * (cols - 1)) / cols : min
  const v = useVirtualizer({ count: Math.ceil(items.length / cols), getScrollElement: () => box.current, estimateSize: () => cell + 56 + gapY, overscan: 3 })
  return (
    <div ref={box} className={`min-h-0 flex-1 overflow-y-auto ${className}`}>
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {width > 0 &&
          v.getVirtualItems().map((r) => (
            <ul key={`${r.key}-${cols}`} data-index={r.index} ref={v.measureElement} className="absolute inset-x-0 grid" style={{ top: r.start, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: gapX, paddingBottom: gapY }}>
              {items.slice(r.index * cols, r.index * cols + cols).map((t) => (
                <li key={itemKey(t)}>{render(t)}</li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}

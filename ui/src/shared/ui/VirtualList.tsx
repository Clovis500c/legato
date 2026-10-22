import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, type ReactNode } from 'react'

/** Fixed-height rows, virtualized (Artists: thousands at 50k songs). `children` draws one row (role="listitem"). */
export function VirtualList<T>({ items, rowHeight, children, className = '' }: { items: T[]; rowHeight: number; children: (t: T, i: number) => ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: items.length, getScrollElement: () => box.current, estimateSize: () => rowHeight, overscan: 10 })
  return (
    <div ref={box} role="list" className={`min-h-0 flex-1 overflow-y-auto ${className}`}>
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((r) => (
          <div key={r.key} className="absolute inset-x-0" style={{ top: r.start, height: rowHeight }}>
            {children(items[r.index], r.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

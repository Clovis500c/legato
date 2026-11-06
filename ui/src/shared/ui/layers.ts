// Overlays a Back press closes (Android's Back on the phone): newest last. Pure, no window at load.
const stack: (() => void)[] = []

/** Joins the stack; the returned function leaves it (unmount). */
export function holdLayer(close: () => void): () => void {
  stack.push(close)
  return () => {
    const i = stack.lastIndexOf(close)
    if (i >= 0) stack.splice(i, 1)
  }
}

export const hasLayer = () => stack.length > 0

/** Closes the newest one. False: none open. */
export function closeTopLayer(): boolean {
  const top = stack.at(-1)
  if (!top) return false
  top()
  return true
}

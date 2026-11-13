/** Opens the TV home each time it becomes wanted (the mode and the TV home setting both on), also at launch. Returns cleanup. */
export function startTvHome(wanted: () => boolean, subscribe: (f: () => void) => () => void, open: () => void): () => void {
  let was = false
  const check = () => {
    const now = wanted()
    if (now && !was) open()
    was = now
  }
  check()
  return subscribe(check)
}

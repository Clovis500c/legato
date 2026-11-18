import { locale, tr } from '../../shared/i18n/i18n'

/** The one reason a pick scored most (docs/recommendation.md, slice 2): language-free, said by `pickWhyText`. */
export type PickWhy = { kind: 'radios'; n: number } | { kind: 'radio' } | { kind: 'after' } | { kind: 'artist' } | { kind: 'style' } | { kind: 'new' }

/** What a pick's fit is made of (score.ts): the parts, each already weighted. */
export interface FitParts {
  features: number
  song: number
  artist: number
  radio: number
}

/** The reason of a pick: an explore slot is "new"; else the largest part of its fit (a tie goes to the crowd, then to what you play together). */
export function whyOf(parts: FitParts, votes: number | undefined, explore: boolean): PickWhy {
  if (explore) return { kind: 'new' }
  const order: [PickWhy['kind'], number][] = [['radio', parts.radio], ['after', parts.song], ['artist', parts.artist], ['style', parts.features]]
  const [top] = order.reduce((best, x) => (x[1] > best[1] ? x : best))
  if (top === 'radio') return (votes ?? 1) >= 2 ? { kind: 'radios', n: votes! } : { kind: 'radio' }
  return { kind: top } as PickWhy
}

/** "In 3 radios of what you played", "You often play it next to songs like these". */
export function pickWhyText(w: PickWhy): string {
  switch (w.kind) {
    case 'radios':
      return tr('In {n} radios of what you played', { n: new Intl.NumberFormat(locale()).format(w.n) })
    case 'radio':
      return tr('In a radio of what you played')
    case 'after':
      return tr('You often play it next to songs like these')
    case 'artist':
      return tr('By an artist you play next to these songs')
    case 'style':
      return tr('Sounds like what is playing')
    case 'new':
      return tr('Something new for you')
  }
}

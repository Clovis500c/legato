/** The queue rows after the playing one, in the play order, for the TV home's Up next tiles (`order`: row indexes; `index`: the playing row). Unplayable ones left out, as the Up next panel does (`queueRows`). */
export const tvQueue = (order: readonly number[], index: number, max: number, playable: (i: number) => boolean = () => true): number[] =>
  order
    .slice(order.indexOf(index) + 1)
    .filter(playable)
    .slice(0, Math.max(0, max))

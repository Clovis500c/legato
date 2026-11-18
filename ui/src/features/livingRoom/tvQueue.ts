/** The queue rows after the playing one, in the play order, for the TV home's Up next tiles (`order`: row indexes; `index`: the playing row). */
export const tvQueue = (order: readonly number[], index: number, max: number): number[] => order.slice(order.indexOf(index) + 1, order.indexOf(index) + 1 + Math.max(0, max))

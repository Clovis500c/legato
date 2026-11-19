/**
 * A settings row, one style for every page (Settings, About, the fades): the words and the controls on one line; in a narrow pane
 * (the phone, a small window; the page is an `@container`) the row wraps and the words keep at least half of it, so a wide control
 * goes under them instead of squeezing a description into a column one or two words wide.
 */
export const ROW = 'flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0 @max-lg:flex-wrap @max-lg:gap-y-2.5'
/** The words of a row. */
export const ROW_TEXT = 'min-w-0 flex-1 @max-lg:min-w-[55%]'

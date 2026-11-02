/** The cover display's clock: the time as the interface's language writes it (24 h or 12 h), the day under it. */
export function clockText(d: Date, locale: string): { time: string; day: string } {
  return {
    time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d),
    day: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(d),
  }
}

/** Ms until the next minute starts: the clock turns on the minute, never up to a minute late. */
export const toNextMinute = (d: Date) => 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds())

/** Settings that mean nothing on a phone (a window, a tray, a keyboard, a PC's sound): hidden there, in the page and in the search. Ids are the rows' English labels (`data-setting`). */
export const DESKTOP_ONLY: ReadonlySet<string> = new Set([
  'Interface size',
  'Mini player',
  'Mini player place',
  'Phone remote',
  'Streaming overlay',
  'Update channel',
  'Automatic updates',
  'Open at startup',
  'Keep running in the notification area',
  'Reopen where you left off',
  'Voice search',
  'Music Detector',
  'Pause during calls',
  'Pause when headphones disconnect',
])

/** Whole sections with no phone use. */
export const DESKTOP_ONLY_SECTIONS: ReadonlySet<string> = new Set(['shortcuts'])

/**
 * Settings groups folded on the phone (plan-v2 › Against Liner › U1): the rare ones, each a heading that opens on a tap,
 * under "More settings" at the section's foot; the common ones stay first and open. Ids: the groups' English titles
 * (`data-setting`). A search result inside opens its fold (SettingsView). Decided alone (2026-11-06): the owner judges.
 */
export const PHONE_FOLDED: ReadonlySet<string> = new Set([
  // General
  'Cover cache',
  'Library backup',
  'Search bar',
  'Voice and recognition',
  // Playback
  'Clicks',
  'Headphones and calls',
  'Screen',
  'Phone remote',
  'Streaming overlay',
  'YouTube videos',
  // Appearance
  'Interface size',
  'Font',
  'Covers',
  'List density',
  'Immersive player',
  'Hi-Fi extras',
  'Lists and navigation',
  'Mixes',
  'List columns',
])

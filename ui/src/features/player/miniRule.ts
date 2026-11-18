/**
 * Where a YouTube song's video and the mini player go (the owner's choice, 2026-11-18, against YouTube's rule that its embed
 * stays visible; the phone's since 2026-11-06): the video shows only in Now Playing, or in the mini player when that is on.
 * Otherwise it plays out of sight (`hidden` / `parked`: a zero-size slot). Pure.
 */
export type Slot = 'card' | 'hidden' | 'none'

/** The right panel holds the mini player: chosen, and there is one (a narrow window and a phone have none; 2026-11-18: on a
 *  phone its hidden panel took the video into a 0×0 box). */
export const dockedOf = (place: 'panel' | 'float', narrow: boolean, phone: boolean) => place === 'panel' && !narrow && !phone

/** The floating card (MiniPlayer): `docked` = the right panel holds it, `phone` never gets a card over its lists. */
export function miniCard({ video, on, phone, full, docked }: { video: boolean; on: boolean; phone: boolean; full: boolean; docked: boolean }): Slot {
  if (full || docked) return 'none'
  if (video && (phone || !on)) return 'hidden'
  return on ? 'card' : 'none'
}

/** The card on top of the right panel (SidePanel): `stage` the card, `parked` a YouTube video kept unseen, none otherwise. */
export function panelCard({ here, full, playing, video, on }: { here: boolean; full: boolean; playing: boolean; video: boolean; on: boolean }): 'stage' | 'parked' | 'none' {
  if (!here || full) return 'none'
  if (playing && on) return 'stage'
  return video ? 'parked' : 'none'
}

import type { Pickup } from '../../shared/api'

/**
 * Another PC's last song is worth offering here: playable on this PC (in its library, or a YouTube video) and newer
 * than this PC's own saved session (one saved before sessions had a time counts as older).
 */
export function worthOffering(p: Pickup, own: unknown): boolean {
  if (p.trackId == null && !p.track.ids.youtube) return false
  const at = own && typeof own === 'object' ? (own as { at?: unknown }).at : undefined
  return typeof at !== 'number' || p.at > at
}

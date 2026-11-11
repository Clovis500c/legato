// Which own playlists hold a song: the player's menus check them (a click takes the song out) and name the one the queue plays from.
type Own = { id: number; name: string; custom: boolean }

export const holds = (orders: Record<number, number[]>, playlistId: number, trackId: number) => !!orders[playlistId]?.includes(trackId)

/** The own playlist the queue plays from (its name is all the queue keeps) when it still holds the song. */
export function playingFrom<P extends Own>(playlists: P[], orders: Record<number, number[]>, from: string | undefined, trackId: number): P | undefined {
  // shortcut: matched by name, two own playlists with one name give the first; the checks in "Add to playlist" still cover both.
  return from ? playlists.find((p) => p.custom && p.name === from && holds(orders, p.id, trackId)) : undefined
}

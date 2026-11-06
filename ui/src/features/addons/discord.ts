import { useSettings } from '../../app/settings'
import { api, type Presence } from '../../shared/api'
import { phoneApp } from '../../shared/platform'
import { primaryArtist } from '../library/filter'
import { nowTrack, usePlayer } from '../player/store'
import { asksPicture, presenceFor, samePresence } from './presence'
import { DISCORD } from './registry'

// Artists' pictures found (Discord's small image), by primary artist; the add-on's preview reads them too.
// shortcut: one URL per artist for the session; bound it if a tray session ever plays thousands of artists.
const pictures = new Map<string, string>()
const pictureKey = (artist: string) => primaryArtist(artist).toLowerCase()
export const artistPicture = (artist: string) => pictures.get(pictureKey(artist)) ?? null

/** Discord Rich Presence add-on: follows the player, sends only real changes (Rust spaces them out). */
export function startDiscord(): () => void {
  // A phone has no Discord app to talk to (local IPC); the switch still comes from a PC by sync.
  if (phoneApp) return () => {}
  let last: { p: Presence | null; at: number; appId: string } | undefined
  // Play whose artist's picture was asked for: once a play, Rust paces the lookups (`discord_artist_art`).
  let asked = -1
  const push = () => {
    const { addons, discord } = useSettings.getState().settings
    if (!addons[DISCORD] || !discord.appId) {
      if (last) void api.discordOff()
      last = undefined
      return
    }
    const { now, playing, positionMs, durationMs, playId } = usePlayer.getState()
    if (now && asksPicture(now, playing, positionMs) && asked !== playId && !artistPicture(now.artist)) {
      asked = playId
      const key = pictureKey(now.artist)
      // YouTube Music is asked for a song YouTube plays only (it knows what plays); others take a picture found already.
      void api.discordArtistArt(primaryArtist(now.artist), now.via === 'youtube').then(
        (url) => {
          if (!url) return
          pictures.set(key, url)
          push()
        },
        () => {},
      )
    }
    const track = nowTrack()
    const p = presenceFor(now, track, playing, positionMs, durationMs, discord, now ? artistPicture(now.artist) : null)
    const at = Date.now()
    if (last && last.appId === discord.appId && samePresence(last.p, last.at, p, at)) return
    last = { p, at, appId: discord.appId }
    void api.discordPresence(discord.appId, p)
  }
  const offPlayer = usePlayer.subscribe(push)
  const offSettings = useSettings.subscribe(push)
  push()
  return () => {
    offPlayer()
    offSettings()
  }
}

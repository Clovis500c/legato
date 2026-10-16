import { useSettings } from '../../app/settings'
import { api, type Presence } from '../../shared/api'
import { nowTrack, usePlayer } from '../player/store'
import { presenceFor, samePresence } from './presence'
import { DISCORD } from './registry'

/** Discord Rich Presence add-on: follows the player, sends only real changes (Rust spaces them out). */
export function startDiscord(): () => void {
  let last: { p: Presence | null; at: number; appId: string } | undefined
  const push = () => {
    const { addons, discord } = useSettings.getState().settings
    if (!addons[DISCORD] || !discord.appId) {
      if (last) void api.discordOff()
      last = undefined
      return
    }
    const { now, playing, positionMs, durationMs } = usePlayer.getState()
    const track = nowTrack()
    const p = presenceFor(now, track, playing, positionMs, durationMs, discord)
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

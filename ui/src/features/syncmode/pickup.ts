import { create } from 'zustand'
import { useStore } from '../../app/store'
import { api, type Pickup } from '../../shared/api'
import { tr } from '../../shared/i18n/i18n'
import { remoteTrack, usePlayer } from '../player/store'
import { worthOffering } from './pickupOffer'

/** Another PC's last song, offered while nothing plays here (player bar). */
export const usePickup = create<{ offer: Pickup | null }>(() => ({ offer: null }))

/** Plays the offered song here, from where the other PC was. */
export function pickUp() {
  const p = usePickup.getState().offer
  if (!p) return
  usePickup.setState({ offer: null })
  const t = (p.trackId != null && useStore.getState().tracks.find((x) => x.id === p.trackId)) || remoteTrack(p.track)
  usePlayer.getState().resume({ list: [t], index: 0, order: [], added: [], shuffle: false, repeat: 'off', positionMs: p.positionMs, paused: false })
}

/** Sync Mode's part: offers what another PC played last (toast once a run, then the idle player bar). Returns cleanup. */
export function startPickup(): () => void {
  let told = false
  const offer = async (p: Pickup | null) => {
    if (!p || usePlayer.getState().now) return
    if (!worthOffering(p, await api.loadSession().catch(() => null)) || usePlayer.getState().now) return
    usePickup.setState({ offer: p })
    if (told) return
    told = true
    useStore.getState().notify(tr('{device} was playing “{title}”', { device: p.deviceName, title: p.track.title }), { kind: 'info', action: { label: tr('Resume here'), run: pickUp } })
  }
  const off = api.onSyncPickup((p) => void offer(p))
  void api.syncPickup().then(offer, () => {})
  // Playing here: this PC's own session is the newest now.
  const unsub = usePlayer.subscribe((s) => {
    if (s.now && usePickup.getState().offer) usePickup.setState({ offer: null })
  })
  return () => {
    unsub()
    void off.then((f) => f())
  }
}

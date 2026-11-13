import { create } from 'zustand'
import { api } from '../../shared/api'

/** The system's output devices and the one picked (null: the system's default), asked each time the player menu is built. */
export const useOutputs = create<{ names: string[]; current: string | null }>(() => ({ names: [], current: null }))

export function refreshOutputs() {
  api.outputDevices().then((o) => useOutputs.setState({ names: o.names, current: o.current }), () => {})
}

export function chooseOutput(name: string | null) {
  api.setOutputDevice(name).then(() => useOutputs.setState({ current: name }), () => refreshOutputs())
}

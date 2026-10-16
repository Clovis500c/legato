import { useSettings } from '../../app/settings'

export const isOn = (id: string) => useSettings.getState().settings.addons[id] === true

export function setAddon(id: string, on: boolean) {
  const { settings, update } = useSettings.getState()
  update({ addons: { ...settings.addons, [id]: on } })
}

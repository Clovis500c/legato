// Android's Back (MainActivity.kt asks `window.legatoBack()` first): closes what's on top, else goes back a page;
// false at the root, where the app goes behind the others. Unused on the PC (its Back is Alt+Left, the mouse's button).
import { backStep } from './backStep'
import { useStore } from './store'
import { closeMenu, menuOpen } from '../shared/ui/ContextMenu'
import { closeTopLayer, hasLayer } from '../shared/ui/layers'
import { closeKaraoke, useKaraoke } from '../features/player/karaokeMode'
import { closeCoverFull, useCoverFull } from '../features/player/coverFull'
import { closeVizFull, useVizFull } from '../features/player/vizFull'
import { usePlayer } from '../features/player/store'

declare global {
  interface Window {
    legatoBack?: () => boolean
  }
}

function back(): boolean {
  const player = usePlayer.getState()
  const step = backStep({
    menu: menuOpen(),
    layer: hasLayer(),
    viz: useVizFull.getState().open,
    cover: useCoverFull.getState().open,
    karaoke: useKaraoke.getState().open,
    full: player.full,
    canBack: useStore.getState().back.length > 0,
  })
  if (step === 'menu') closeMenu()
  else if (step === 'layer') closeTopLayer()
  else if (step === 'viz') closeVizFull()
  else if (step === 'cover') closeCoverFull()
  else if (step === 'karaoke') closeKaraoke()
  else if (step === 'full') player.setFull(false)
  else if (step === 'page') useStore.getState().goBack()
  return step !== null
}

/** Returns its undo (App's effect). */
export function installBack(): () => void {
  window.legatoBack = back
  return () => {
    if (window.legatoBack === back) delete window.legatoBack
  }
}

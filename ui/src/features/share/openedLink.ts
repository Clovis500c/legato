import { useStore } from '../../app/store'
import { api } from '../../shared/api'
import { isRemixLink } from '../editor/remixLink'
import { isShareCode } from './shareCode'

/**
 * A `legato://` link Windows handed to the app (the share page's Open in Legato): at the start, and at each second
 * launch. Untrusted text: only what a pasted link must look like (`isShareCode`) goes on, to the same import dialog.
 * Returns cleanup.
 */
export function startOpenedLinks(): () => void {
  const take = () =>
    void api
      .linkPending()
      .then((text) => {
        if (!text) return
        if (isRemixLink(text)) void import('../editor/remixFile').then((m) => m.openRemixLink(text))
        else if (isShareCode(text)) useStore.setState({ incoming: text })
      })
      .catch(() => {})
  take()
  const off = api.onLink(take)
  return () => void off.then((f) => f())
}

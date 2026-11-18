import { useStore } from '../../app/store'
import { api } from '../../shared/api'

/**
 * A Discord link dropped or pasted on the window. Rust checks the link, fetches the file and reads its kind from its bytes
 * (`discord_take`); the path it keeps then goes where a file dropped from disk goes: a remix plays, a picture is read for a
 * shared playlist's code. Anything else, an expired link included, comes back as the app's error line.
 */
export async function takeLink(text: string) {
  try {
    const got = await api.discordTake(text)
    if (!got) return
    if (got.kind === 'remix') return void (await import('../editor/remixFile')).openRemix(got.path)
    useStore.setState({ incoming: await api.shareReadImage(got.path) })
  } catch (e) {
    useStore.setState({ error: String(e) })
  }
}

/** The text a paste or a drop carries, when it names Discord's file servers (the page asks Rust only for those). */
export function discordText(data: DataTransfer | null): string | null {
  const text = data?.getData('text/uri-list') || data?.getData('text/plain') || ''
  return /^\s*https?:\/\/[^\s/]*discordapp\./i.test(text) ? text : null
}

import { FileAudio } from '@phosphor-icons/react'
import { useState } from 'react'
import { useStore } from '../../app/store'
import { api, type SpotifyList, type SpotifyPick } from '../../shared/api'
import { pickFile } from '../../shared/files'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Card } from './Card'
import { ListPick } from './ListPick'

interface Read {
  path: string
  lists: SpotifyList[]
  /** Smart playlists: offered unticked (iTunes makes several by itself). */
  smart: string[]
}

/** iTunes' or MusicBee's library file (iTunes Music Library.xml): its playlists ticked, then the import screen (src-tauri/src/libfile.rs). */
export function AppFileImport() {
  const [file, setFile] = useState<Read>()
  const [busy, setBusy] = useState(false)
  const pick = async () => {
    const path = await pickFile({ title: tr('Library file'), filters: [{ name: tr('iTunes library file'), extensions: ['xml'] }] }).catch((e) => void useStore.setState({ error: String(e) }))
    if (!path) return
    setBusy(true)
    try {
      const found = await api.libraryFileLists(path)
      setFile({ path, lists: found.map((l) => ({ id: l.id, name: l.name, cover: null, songs: l.songs })), smart: found.filter((l) => l.smart).map((l) => l.id) })
    } catch (e) {
      useStore.setState({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }
  const start = (picks: SpotifyPick[]) => {
    if (!file) return
    setFile(undefined)
    void useStore.getState().importSpotifyLists(() => api.libraryFileImport(file.path, picks), 'file')
  }
  return (
    <Card icon={FileAudio} title={tr('From iTunes or MusicBee')} sub={tr('Open the library file, iTunes Music Library.xml (MusicBee can write one too), and pick its playlists. Songs not in your music folders are found on YouTube.')}>
      <Button disabled={busy} onClick={() => void pick()} className="mt-auto self-start">
        {busy ? tr('Reading the file…') : tr('Open the library file…')}
      </Button>
      {file && <ListPick title={tr('Playlists in the library file')} lists={file.lists} unticked={file.smart} onClose={() => setFile(undefined)} onStart={start} />}
    </Card>
  )
}

import { ListPlus } from '@phosphor-icons/react'
import { openMenu } from '../../shared/ui/ContextMenu'
import { RoundButton } from '../../shared/ui/controls'
import { addToItems } from '../menus'

/**
 * Row and Now Playing action: the song menus' Add to playlist choices, as a menu of their own (drawn in body: no list
 * scroller can clip it, no animated parent can move it). `trackIds` may be a function: tracks not in the library yet
 * get added once a playlist is picked.
 */
export function AddToPlaylist({ trackIds, label }: { trackIds: number[] | (() => Promise<number[]>); label: string }) {
  return (
    <RoundButton label={label} kind="plain" size="xs" onClick={(e) => openMenu(e, addToItems(typeof trackIds === 'function' ? trackIds : () => trackIds))}>
      <ListPlus size={14} />
    </RoundButton>
  )
}

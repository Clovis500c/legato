import { create } from 'zustand'

/** The on-screen keyboard (living-room mode): the text field it types into while it is open. */
export const useOsk = create<{ target: HTMLInputElement | HTMLTextAreaElement | null }>(() => ({ target: null }))
export const openOsk = (target: HTMLInputElement | HTMLTextAreaElement) => useOsk.setState({ target })
export const closeOsk = () => useOsk.setState({ target: null })

/** Rows of keys, letters first (a gamepad or the arrows walk the grid). */
export const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', "-'.,@"].map((r) => [...r])

export type Press = { key: string } | 'space' | 'back' | 'clear'

/** The field's text after a key (typed at the end: no cursor on a sofa). */
export function press(value: string, p: Press): string {
  if (p === 'back') return [...value].slice(0, -1).join('')
  if (p === 'clear') return ''
  if (p === 'space') return value.endsWith(' ') || !value ? value : `${value} `
  return value + p.key
}

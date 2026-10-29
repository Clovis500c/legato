import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store'

describe('notifications', () => {
  afterEach(() => {
    vi.useRealTimers()
    useStore.setState({ toasts: [], toastPrefs: { important: false, scale: 1 } })
  })

  it('important only: errors and the ones with a button', () => {
    useStore.setState({ toasts: [], toastPrefs: { important: true, scale: 1 } })
    const { notify } = useStore.getState()
    notify('Liked')
    notify('Removed', { kind: 'removed', action: { label: 'Undo', run: () => {} } })
    notify('Failed', { kind: 'error' })
    expect(useStore.getState().toasts.map((t) => t.text)).toEqual(['Removed', 'Failed'])
  })

  it('stays its time times the chosen scale', () => {
    vi.useFakeTimers()
    useStore.setState({ toasts: [], toastPrefs: { important: false, scale: 2 } })
    useStore.getState().notify('Liked')
    vi.advanceTimersByTime(7_900)
    expect(useStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(200)
    expect(useStore.getState().toasts).toHaveLength(0)
  })
})

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Picture } from './Picture'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string, s: string) => `http://${s}.localhost/${encodeURIComponent(p)}`, invoke: vi.fn() }))

describe('a remote picture', () => {
  it('goes through the art scheme, never straight to the host', () => {
    const html = renderToString(createElement(Picture, { url: 'https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=64', className: 'c', fallback: 'N' }))
    expect(html).toContain('src="http://art.localhost/')
    expect(html).not.toContain('src="https://')
  })

  it('shows the fallback (the initial) when there is no address', () => {
    expect(renderToString(createElement(Picture, { url: null, className: 'c', fallback: 'N' }))).toBe('N')
  })
})

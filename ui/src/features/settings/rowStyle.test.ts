import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { ROW, ROW_TEXT } from './rowStyle'

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')

it('a settings row wraps on a narrow pane and keeps its words at least half the row', () => {
  expect(ROW).toContain('@max-lg:flex-wrap')
  expect(ROW_TEXT).toContain('@max-lg:min-w-[55%]')
  // Desktop: one line, the words taking the room.
  expect(ROW).toContain('flex items-center gap-4')
  expect(ROW_TEXT).toContain('flex-1')
})

it('every settings page draws its rows with the shared style, so none is squeezed (the About page was)', () => {
  for (const f of ['SettingsView.tsx', 'AboutSection.tsx', 'FadeEditor.tsx']) {
    expect(read(f), f).toContain('ROW')
    expect(read(f), f).not.toMatch(/className="flex items-center gap-4 border-b border-line-soft px-4 py-3/)
  }
})

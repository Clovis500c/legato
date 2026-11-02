import { expect, it } from 'vitest'
import { parseNotes } from './notes'

it('reads grouped notes, older flat ones and a plain sentence', () => {
  expect(parseNotes('### New\n- Library health page\n\n### Fixed\n- No loop\n- Kept\n\nAnd 5 more.')).toEqual({
    parts: [
      { title: 'New', lines: ['Library health page'] },
      { title: 'Fixed', lines: ['No loop', 'Kept'] },
    ],
    more: 5,
    other: '',
  })
  expect(parseNotes('- Smoother fades\n- No loop\n- And 2 more')).toEqual({ parts: [{ title: null, lines: ['Smoother fades', 'No loop'] }], more: 2, other: '' })
  expect(parseNotes('Small fixes and improvements.')).toEqual({ parts: [], more: 0, other: 'Small fixes and improvements.' })
})

import { afterEach, describe as suite, expect, it, vi } from 'vitest'
import { describe, frames, placeOf, throttled, type Send } from './diag'
import { loadLang, useLang } from './i18n/i18n'

suite('throttled', () => {
  const setup = () => {
    const send = vi.fn<Send>()
    const clock = { t: 1_000_000 }
    return { send, clock, say: throttled(send, () => clock.t) }
  }

  it('says the same line once a minute', () => {
    const { send, clock, say } = setup()
    say('error', 'ui', 'Uncaught error', 'boom')
    say('error', 'ui', 'Uncaught error', 'boom')
    clock.t += 59_000
    say('error', 'ui', 'Uncaught error', 'boom')
    expect(send).toHaveBeenCalledTimes(1)
    clock.t += 2_000
    say('error', 'ui', 'Uncaught error', 'boom')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('lets a different line through at once', () => {
    const { send, say } = setup()
    say('warn', 'ui', 'A command failed', 'one')
    say('warn', 'ui', 'A command failed', 'two')
    say('warn', 'sync', 'A command failed', 'one')
    say('info', 'ui', 'A command failed', 'one')
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('keeps a storm of different lines to 30 a minute, then starts again', () => {
    const { send, clock, say } = setup()
    for (let i = 0; i < 100; i++) say('error', 'ui', 'Render loop', `frame ${i}`)
    expect(send).toHaveBeenCalledTimes(30)
    clock.t += 61_000
    say('error', 'ui', 'Render loop', 'frame 200')
    expect(send).toHaveBeenCalledTimes(31)
  })

  it('never throws, whatever the sender does', () => {
    const say = throttled(() => {
      throw new Error('no IPC')
    })
    expect(() => say('error', 'ui', 'x')).not.toThrow()
  })
})

suite('describe', () => {
  afterEach(() => useLang.setState({ lang: 'en' }))

  it('keeps only the name of an engine error as the message: V8 puts values in the text', () => {
    // Both forms V8 prints with the value in them.
    const create = "Cannot create property 'x' on string 'Stairway to Heaven'"
    const inOp = "Cannot use 'in' operator to search for 'x' in Stairway to Heaven"
    expect(describe(new TypeError(create), 'x')).toEqual({ message: 'TypeError', detail: create })
    expect(describe(new TypeError(inOp), 'x')).toEqual({ message: 'TypeError', detail: inOp })
    expect(describe(new RangeError('Invalid array length'), 'x')).toEqual({ message: 'RangeError', detail: 'Invalid array length' })
    expect(describe(new ReferenceError('foo is not defined'), 'x')).toEqual({ message: 'ReferenceError', detail: 'foo is not defined' })
    expect(describe(new TypeError(''), 'x')).toEqual({ message: 'TypeError', detail: undefined })
  })

  it('keeps what a Rust error said for the detail, our words for the message', () => {
    const raw = 'Can’t open C:\\Users\\jane\\Music\\Secret Song.mp3: No such file'
    expect(describe(raw, 'A command failed')).toEqual({ message: 'A command failed', detail: raw })
    expect(describe(new Error(`Error: ${raw}`), 'A command failed').message).toBe('A command failed')
    // A rejected thrown Error with a title in it is no engine error either.
    expect(describe(new Error('No match for “Hidden Title”'), 'Unhandled promise rejection').message).toBe('Unhandled promise rejection')
  })

  it('puts a network failure in plain English whatever the interface speaks', async () => {
    await loadLang('fr')
    const raw = 'YouTube Music: error sending request for url (https://music.youtube.com/youtubei/v1/search?prettyPrint=false): dns error'
    expect(describe(raw, 'A command failed')).toEqual({ message: 'YouTube Music: No internet connection: check your network, then try again.', detail: raw })
  })

  it('has no detail for an empty error', () => {
    expect(describe('', 'Uncaught error')).toEqual({ message: 'Uncaught error', detail: undefined })
  })
})

suite('placeOf', () => {
  it('gives the file and position of the first frame, nothing of the message', () => {
    const e = new TypeError("Cannot create property 'x' on string 'Stairway to Heaven'")
    expect(placeOf(e)).toMatch(/^ at [\w.-]+:\d+:\d+$/)
    expect(placeOf(e)).not.toMatch(/Stairway|[\\/]/)
    expect(placeOf(new Error(''))).toMatch(/^ at [\w.-]+:\d+:\d+$/)
  })

  it('does not take a frame from a message that imitates one', () => {
    const e = new TypeError('bad value\n    at Evil (C:\\Users\\jane\\Music\\Secret Song.mp3:1:1)')
    expect(placeOf(e)).not.toMatch(/Secret|jane|Evil/)
    expect(placeOf(e)).toMatch(/^ at [\w.-]+:\d+:\d+$/)
  })

  it('reads a frame with a path, a bare one, and none', () => {
    const at = (frame: string) => Object.assign(new Error('boom'), { stack: `Error: boom\n${frame}` })
    expect(placeOf(at('    at run (http://tauri.localhost/assets/index-abc.js:12:34)'))).toBe(' at index-abc.js:12:34')
    expect(placeOf(at('    at http://tauri.localhost/assets/index-abc.js?v=2:5:6'))).toBe(' at index-abc.js:5:6')
    expect(placeOf(at('    at C:\\Users\\jane\\app\\main.js:7:8'))).toBe(' at main.js:7:8')
    expect(placeOf(at('    at async Promise.all (index 0)'))).toBe('')
  })

  it('gives nothing for a stack that does not open with the message, or a non-Error', () => {
    expect(placeOf(Object.assign(new Error('boom'), { stack: 'Error: other\n    at a (b.js:1:2)' }))).toBe('')
    expect(placeOf(Object.assign(new Error('boom'), { stack: undefined }))).toBe('')
    expect(placeOf('Error: x\n    at a (b.js:1:2)')).toBe('')
    expect(placeOf(undefined)).toBe('')
  })
})

suite('frames', () => {
  it('names the first components of a React stack', () => {
    const stack = '\n    at Sidebar (http://tauri.localhost/assets/index-abc.js:1:2)\n    at div\n    at Shell (http://tauri.localhost/assets/index-abc.js:3:4)\n    at App'
    expect(frames(stack)).toBe(' in Sidebar < div < Shell < App')
    expect(frames(stack, 2)).toBe(' in Sidebar < div')
    expect(frames(undefined)).toBe('')
    expect(frames('nothing useful')).toBe('')
  })
})

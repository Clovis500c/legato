import { afterEach, describe as suite, expect, it, vi } from 'vitest'
import { describe, frames, throttled, type Send } from './diag'
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

  it('trusts the engine’s own errors, which name a property and no value', () => {
    expect(describe(new TypeError("Cannot read properties of undefined (reading 'title')"), 'x')).toEqual({ message: "TypeError: Cannot read properties of undefined (reading 'title')" })
    expect(describe(new ReferenceError('foo is not defined'), 'x').message).toBe('ReferenceError: foo is not defined')
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

suite('frames', () => {
  it('names the first components of a React stack', () => {
    const stack = '\n    at Sidebar (http://tauri.localhost/assets/index-abc.js:1:2)\n    at div\n    at Shell (http://tauri.localhost/assets/index-abc.js:3:4)\n    at App'
    expect(frames(stack)).toBe(' in Sidebar < div < Shell < App')
    expect(frames(stack, 2)).toBe(' in Sidebar < div')
    expect(frames(undefined)).toBe('')
    expect(frames('nothing useful')).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { askMic, type PhoneBridge, openAppInfo } from './phoneMic'

/** Android's side, answering each message. */
function phone(answer: string) {
  const sent: string[] = []
  const mic: PhoneBridge = {
    onmessage: null,
    postMessage(text) {
      sent.push(text)
      queueMicrotask(() => mic.onmessage?.({ data: answer }))
    },
  }
  return { mic, sent }
}

describe('phone microphone', () => {
  it('asks Android and takes its answer', async () => {
    const yes = phone('yes')
    expect(await askMic(yes.mic)).toBe(true)
    expect(yes.sent).toEqual(['ask'])
    expect(yes.mic.onmessage).toBeNull()
    expect(await askMic(phone('no').mic)).toBe(false)
  })

  it('a PC has no bridge: recording is left to try', async () => {
    expect(await askMic(undefined)).toBe(true)
  })

  it('opens the app info', () => {
    const p = phone('')
    openAppInfo(p.mic)
    expect(p.sent).toEqual(['settings'])
  })
})

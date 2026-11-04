import { describe, expect, it } from 'vitest'
import { folderList, phoneFolders, withPhone } from './phoneMusic'
import type { PhoneBridge } from './phoneMic'

/** Android's side, answering each message. */
function phone(answer: string) {
  const sent: string[] = []
  const music: PhoneBridge = {
    onmessage: null,
    postMessage(text) {
      sent.push(text)
      queueMicrotask(() => music.onmessage?.({ data: answer }))
    },
  }
  return { music, sent }
}

const FOLDERS = ['/storage/emulated/0/Music', '/storage/emulated/0/Download']

describe('phone songs', () => {
  it('asks Android and takes its folders', async () => {
    const yes = phone(JSON.stringify(FOLDERS))
    expect(await phoneFolders('ask', yes.music)).toEqual(FOLDERS)
    expect(yes.sent).toEqual(['ask'])
    expect(yes.music.onmessage).toBeNull()
    const check = phone('no')
    expect(await phoneFolders('check', check.music)).toBeNull()
    expect(check.sent).toEqual(['check'])
  })

  it('a PC has no bridge: no phone folders', async () => {
    expect(await phoneFolders('ask', undefined)).toBeNull()
  })

  it('keeps absolute paths only from the answer', () => {
    expect(folderList('no')).toBeNull()
    expect(folderList('not json')).toBeNull()
    expect(folderList(42)).toBeNull()
    expect(folderList('{"a":1}')).toBeNull()
    expect(folderList(JSON.stringify(['/storage/emulated/0/Music', 'relative', 7]))).toEqual(['/storage/emulated/0/Music'])
  })

  it('adds the phone folders once', () => {
    expect(withPhone(['/storage/emulated/0/Music'], FOLDERS)).toEqual(FOLDERS)
    expect(withPhone([], FOLDERS)).toEqual(FOLDERS)
  })
})

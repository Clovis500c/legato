import { describe, expect, it } from 'vitest'
import { FILLER_WORDS, PHRASES, PLAY_WORDS, voiceCommand } from './voiceCommand'

const english = (s: string) => s
const LISTS = [
  { id: 1, name: 'Running' },
  { id: 2, name: 'Running Fast' },
  { id: 3, name: 'Été à Paris' },
  { id: 4, name: 'ランニング' },
]

describe('voice commands', () => {
  it('knows a command said alone, in English', () => {
    expect(voiceCommand('Next.', LISTS, english)).toEqual({ action: 'next' })
    expect(voiceCommand('skip this song', LISTS, english)).toEqual({ action: 'next' })
    expect(voiceCommand('Turn it up!', LISTS, english)).toEqual({ action: 'louder' })
    expect(voiceCommand('I like this song', LISTS, english)).toEqual({ action: 'like' })
  })

  it('knows the interface language’s phrases too', () => {
    const fr: Record<string, string> = { [PHRASES.next]: 'suivant|chanson suivante', [PLAY_WORDS]: 'joue|mets', [FILLER_WORDS]: 'ma|la|playlist' }
    const t = (s: string) => fr[s] ?? s
    expect(voiceCommand('Chanson suivante', LISTS, t)).toEqual({ action: 'next' })
    expect(voiceCommand('next', LISTS, t)).toEqual({ action: 'next' })
    expect(voiceCommand('Mets ma playlist été à Paris', LISTS, t)).toEqual({ action: 'playlist', id: 3 })
  })

  it('plays a playlist named with a play word, the longest name said', () => {
    expect(voiceCommand('Play my running playlist', LISTS, english)).toEqual({ action: 'playlist', id: 1 })
    expect(voiceCommand('play running fast', LISTS, english)).toEqual({ action: 'playlist', id: 2 })
    const ja: Record<string, string> = { [PLAY_WORDS]: '再生|再生して|かけて', [FILLER_WORDS]: 'の|を|プレイリスト' }
    expect(voiceCommand('ランニングのプレイリストを再生して', LISTS, (s) => ja[s] ?? s)).toEqual({ action: 'playlist', id: 4 })
  })

  it('works with the real French and Japanese phrases', async () => {
    const table = async (code: string) => ((await import(`../../shared/i18n/locales/${code}.ts`)) as { default: Record<string, string> }).default
    const fr = await table('fr')
    const t = (s: string) => fr[s] ?? s
    expect(voiceCommand('Chanson suivante.', LISTS, t)).toEqual({ action: 'next' })
    expect(voiceCommand('Monte le son', LISTS, t)).toEqual({ action: 'louder' })
    expect(voiceCommand("J'aime cette chanson", LISTS, t)).toEqual({ action: 'like' })
    expect(voiceCommand('Mets ma playlist Été à Paris, s’il te plaît', LISTS, t)).toEqual({ action: 'playlist', id: 3 })
    const ja = await table('ja')
    expect(voiceCommand('ランニングのプレイリストを再生して', LISTS, (s) => ja[s] ?? s)).toEqual({ action: 'playlist', id: 4 })
    expect(voiceCommand('次の曲', LISTS, (s) => ja[s] ?? s)).toEqual({ action: 'next' })
  })

  it('leaves the rest to search', () => {
    expect(voiceCommand('Daft Punk', LISTS, english)).toBeNull()
    // No play word, or other words around the name: a search.
    expect(voiceCommand('running playlist', LISTS, english)).toBeNull()
    expect(voiceCommand('play running up that hill', LISTS, english)).toBeNull()
    expect(voiceCommand('next to me', LISTS, english)).toBeNull()
    expect(voiceCommand('', LISTS, english)).toBeNull()
  })
})

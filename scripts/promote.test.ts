import { describe, expect, it } from 'vitest'
import { notesFrom } from './notes.mjs'
import { compareTags, newestBeta, parseTag, refusal, toTag, withNotes } from './promote.mjs'

const rel = (tagName: string, isPrerelease = true, isDraft = false) => ({ tagName, isPrerelease, isDraft })

describe('promote', () => {
  it('reads version tags, not the rolling beta release', () => {
    expect(parseTag('v1.0.375')).toEqual([1, 0, 375])
    expect(parseTag('beta')).toBeNull()
    expect(parseTag('v1.0')).toBeNull()
    expect(toTag('1.0.375')).toBe('v1.0.375')
    expect(toTag(' v1.0.375 ')).toBe('v1.0.375')
    expect(() => toTag('beta')).toThrow('not a version')
  })

  it('compares numbers, not text', () => {
    expect(compareTags('v1.0.1000', 'v1.0.999')).toBeGreaterThan(0)
    expect(compareTags('v1.1.0', 'v1.0.999')).toBeGreaterThan(0)
    expect(compareTags('v2.0.0', 'v1.9.9')).toBeGreaterThan(0)
    expect(compareTags('v1.0.5', 'v1.0.5')).toBe(0)
  })

  it('picks the newest prerelease by version, skipping drafts, normal releases and the beta pointer', () => {
    const list = [rel('beta'), rel('v1.0.9', false), rel('v1.0.12', true, true), rel('v1.0.10'), rel('v1.0.11'), rel('v1.0.2')]
    expect(newestBeta(list)?.tagName).toBe('v1.0.11')
    expect(newestBeta([rel('v1.0.9', false), rel('beta')])).toBeUndefined()
  })

  it('refuses what is not a beta newer than the current Stable', () => {
    expect(refusal(rel('v1.0.11'), 'v1.0.9')).toBeUndefined()
    expect(refusal(rel('v1.0.1000'), 'v1.0.999')).toBeUndefined()
    expect(refusal(rel('v1.0.11'), undefined)).toBeUndefined()
    expect(refusal(rel('v1.0.9'), 'v1.0.9')).toContain('not newer')
    expect(refusal(rel('v1.0.8'), 'v1.0.9')).toContain('not newer')
    expect(refusal(rel('v1.0.11', false), 'v1.0.9')).toContain('already Stable')
    expect(refusal(rel('v1.0.11', true, true), 'v1.0.9')).toContain('draft')
  })

  const manifest = (over: object = {}) => JSON.stringify({ version: '1.0.11', notes: 'old', pub_date: '2026-10-30T10:00:00Z', platforms: { 'windows-x86_64': { signature: 'sig', url: 'https://example.com/setup.exe' } }, ...over })

  it('rewrites the notes of latest.json and nothing else', () => {
    const out = JSON.parse(withNotes(manifest(), '1.0.11', '- Better fades'))
    expect(out).toEqual({ ...JSON.parse(manifest()), notes: '- Better fades' })
    expect(JSON.parse(withNotes(manifest({ version: 'v1.0.11' }), '1.0.11', 'x')).notes).toBe('x')
  })

  it('does not promote a release whose latest.json is not complete', () => {
    expect(() => withNotes(manifest({ version: '1.0.10' }), '1.0.11', 'x')).toThrow('not a complete updater file')
    expect(() => withNotes(manifest({ platforms: {} }), '1.0.11', 'x')).toThrow('not a complete')
    expect(() => withNotes(manifest({ platforms: { w: { url: 'https://example.com/setup.exe' } } }), '1.0.11', 'x')).toThrow('not a complete')
    expect(() => withNotes('{}', '1.0.11', 'x')).toThrow('not a complete')
  })

  it('words the notes like a release does: feat, fix and perf only', () => {
    expect(notesFrom(['feat(player): smoother fades', 'docs: x', 'fix(sync): no loop', 'chore: y', 'perf: faster'])).toBe('- Smoother fades\n- No loop\n- Faster')
    expect(notesFrom(['docs: x', 'ci: y'])).toBe('Small fixes and improvements.')
    const many = Array.from({ length: 25 }, (_, i) => `fix: n${i}`)
    expect(notesFrom(many).split('\n')).toHaveLength(21)
    expect(notesFrom(many).split('\n').at(-1)).toBe('- And 5 more')
  })
})

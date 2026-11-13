import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPrivateHost, parseLink, requestFor, titleOf } from './app.legato.deck.sdPlugin/logic.mjs'

test('only private addresses are links to talk to', () => {
  for (const ok of ['127.0.0.1', 'localhost', '192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.1', '169.254.1.1']) assert.ok(isPrivateHost(ok), ok)
  for (const no of ['8.8.8.8', '172.32.0.1', '172.15.0.1', 'example.com', '192.169.1.1', '']) assert.ok(!isPrivateHost(no), no)
})

test('a phone remote link is read, anything else refused', () => {
  assert.deepEqual(parseLink(' http://192.168.1.20:47821/?t=ab12 '), { base: 'http://192.168.1.20:47821', token: 'ab12' })
  assert.equal(parseLink('http://192.168.1.20:47821/'), null)
  assert.equal(parseLink('https://192.168.1.20:47821/?t=ab12'), null)
  assert.equal(parseLink('http://evil.example.com/?t=ab12'), null)
  assert.equal(parseLink('not a link'), null)
})

test('each key sends its own request', () => {
  const link = parseLink('http://127.0.0.1:47821/?t=a%2Bb')
  assert.deepEqual(requestFor(link, 'playpause'), { method: 'POST', url: 'http://127.0.0.1:47821/key?k=toggle&t=a%2Bb', redirect: 'error' })
  assert.equal(requestFor(link, 'next').url, 'http://127.0.0.1:47821/key?k=next&t=a%2Bb')
  assert.equal(requestFor(link, 'previous').url, 'http://127.0.0.1:47821/key?k=previous&t=a%2Bb')
  assert.deepEqual(requestFor(link, 'state'), { method: 'GET', url: 'http://127.0.0.1:47821/state?t=a%2Bb', redirect: 'error' })
  assert.equal(requestFor(link, 'like'), null)
})

test('the now playing key shows what plays, cut to fit', () => {
  assert.equal(titleOf(null), '–')
  assert.equal(titleOf({ title: 'Song', artist: 'Band', playing: true }), '▶\nSong\nBand')
  assert.equal(titleOf({ title: 'A very long title', artist: '', playing: false }), '⏸\nA very l…')
})

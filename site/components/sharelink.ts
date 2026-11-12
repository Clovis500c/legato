// A shared playlist read from a link's fragment, in the visitor's browser: the same bytes Legato writes
// (`crates/core/src/share.rs`: zlib, then one entry per song). Nothing here talks to a server.

export type Item = { kind: 'youtube'; id: string; artist: string; title: string; secs: number } | { kind: 'apple'; id: string } | { kind: 'text'; artist: string; title: string }
export interface Shared {
  name: string
  items: Item[]
}

// Rust's limits: bytes from anyone.
const MAX_ITEMS = 10_000
const MAX_TEXT = 300
const MAX_RAW = 4 << 20
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** The playlist from its uncompressed bytes. Throws on anything Rust's `decode` refuses. */
export function readShare(raw: Uint8Array): Shared {
  let at = 0
  const byte = () => {
    if (at >= raw.length) throw new Error('This link is cut short')
    return raw[at++]
  }
  const varint = () => {
    let n = 0
    for (let scale = 1; scale < 2 ** 63; scale *= 128) {
      const b = byte()
      n += (b & 0x7f) * scale
      if (b < 0x80) return n
    }
    throw new Error('This link is damaged')
  }
  const text = () => {
    const len = varint()
    if (len > MAX_TEXT || at + len > raw.length) throw new Error('This link is damaged')
    at += len
    return new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(at - len, at))
  }
  const youtubeId = () => {
    if (at + 8 > raw.length) throw new Error('This link is cut short')
    const n = new DataView(raw.buffer, raw.byteOffset + at, 8).getBigUint64(0)
    at += 8
    let id = ''
    for (let i = 0; i < 10; i++) id += B64[Number((n >> BigInt(4 + 6 * (9 - i))) & 63n)]
    return id + B64[Number(n & 15n) << 2]
  }
  const version = byte()
  if (version !== 1 && version !== 2) throw new Error('This link was made by a newer version of Legato')
  const name = text()
  const count = varint()
  if (count > MAX_ITEMS) throw new Error('This link is damaged')
  const items: Item[] = []
  for (let i = 0; i < count; i++) {
    const tag = byte()
    if (tag === 1) items.push({ kind: 'youtube', id: youtubeId(), artist: '', title: '', secs: 0 })
    else if (tag === 4) items.push({ kind: 'youtube', id: youtubeId(), artist: text(), title: text(), secs: varint() })
    else if (tag === 2) items.push({ kind: 'apple', id: String(varint()) })
    else if (tag === 3) items.push({ kind: 'text', artist: text(), title: text() })
    else throw new Error('This link is damaged')
  }
  if (at !== raw.length) throw new Error('This link is damaged')
  return { name, items }
}

/** zlib's bytes back, stopped past Rust's cap (a small link could unpack to gigabytes). */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_RAW) {
      void reader.cancel()
      throw new Error('This link is damaged')
    }
    parts.push(value)
  }
  const raw = new Uint8Array(size)
  parts.reduce((o, p) => (raw.set(p, o), o + p.length), 0)
  return raw
}

/** The code of a share link's fragment (`#…`, spaces a chat app added dropped). */
export const codeOf = (hash: string) => hash.replace(/^#/, '').replace(/\s+/g, '')

/** The playlist a fragment holds. Throws when it isn't one. */
export async function fromFragment(hash: string): Promise<Shared> {
  const code = codeOf(hash)
  if (!code || /[^A-Za-z0-9_-]/.test(code)) throw new Error('This link holds no playlist')
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
  try {
    return readShare(await inflate(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch (e) {
    // The stream's own errors (bad zlib, bad checksum) say nothing a visitor can use.
    throw e instanceof Error && e.message.startsWith('This link') ? e : new Error('This link is damaged')
  }
}

/** What the page says about a playlist, from the link alone (no lookup): songs, known listening time, where they come from. */
export function summary(list: Shared) {
  const secs = list.items.reduce((n, i) => n + (i.kind === 'youtube' ? i.secs : 0), 0)
  return { songs: list.items.length, minutes: Math.round(secs / 60), youtube: list.items.filter((i) => i.kind === 'youtube').length, apple: list.items.filter((i) => i.kind === 'apple').length }
}

/** A colour for a name, 0 to 359: the same playlist always looks the same (the page has no cover to show). */
export function hueOf(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) % 360
  return h
}

import { bestMatch, normalize, primaryArtist } from '../core/match'
import { OAuthClient } from '../core/oauth'
import type { Connector, PlaylistRef, SecretStore, Track } from '../core/types'

const API = 'https://api.spotify.com/v1'
const SCOPES = 'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public'

interface SpotifyTrack {
  id: string | null
  type?: string
  name: string
  artists: { name: string }[]
  album?: { name: string }
  duration_ms: number
  external_ids?: { isrc?: string }
  is_local?: boolean
}

interface Paging<T> {
  items: T[]
  next: string | null
}

export function fromSpotify(t: SpotifyTrack): Track {
  return {
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: t.album?.name,
    durationMs: t.duration_ms,
    isrc: t.external_ids?.isrc?.toUpperCase(),
    ids: { spotify: t.id! },
  }
}

/** Spotify Web API, Feb 2026 endpoints: /items, POST /me/playlists, search limit ≤ 10. */
export class SpotifyConnector implements Connector {
  readonly source = 'spotify' as const
  private oauth: OAuthClient

  constructor(clientId: string, store: SecretStore, open: (url: string) => unknown, fetchFn: typeof fetch = fetch) {
    this.oauth = new OAuthClient(
      {
        key: 'spotify',
        authUrl: 'https://accounts.spotify.com/authorize',
        tokenUrl: 'https://accounts.spotify.com/api/token',
        clientId,
        scope: SCOPES,
      },
      store,
      open,
      fetchFn,
    )
  }

  isConnected() {
    return this.oauth.isConnected()
  }

  connect() {
    return this.oauth.connect()
  }

  disconnect() {
    this.oauth.disconnect()
  }

  async listPlaylists(): Promise<PlaylistRef[]> {
    const me = await this.oauth.json<{ id: string }>(`${API}/me`)
    const lists = await this.all<{ id: string; name: string; owner: { id: string }; collaborative: boolean }>(
      `${API}/me/playlists?limit=50`,
    )
    // Since Feb 2026: content readable only for owned or collab playlists.
    return lists.filter((p) => p.owner.id === me.id || p.collaborative).map(({ id, name }) => ({ id, name }))
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const entries = await this.all<{ item?: SpotifyTrack | null; track?: SpotifyTrack | null }>(
      `${API}/playlists/${encodeURIComponent(playlistId)}/items?limit=50`,
    )
    return entries
      .map((e) => e.item ?? e.track)
      .filter((t): t is SpotifyTrack => !!t?.id && t.type !== 'episode' && !t.is_local)
      .map(fromSpotify)
  }

  async search(query: string): Promise<Track[]> {
    const r = await this.oauth.json<{ tracks: Paging<SpotifyTrack> }>(
      `${API}/search?${new URLSearchParams({ type: 'track', q: query, limit: '10' })}`,
    )
    return r.tracks.items.filter((t) => t.id).map(fromSpotify)
  }

  async resolve(track: Track): Promise<Track | null> {
    if (track.isrc) {
      const hit = bestMatch(track, await this.search(`isrc:${track.isrc}`))
      if (hit) return hit
    }
    return bestMatch(track, await this.search(`${normalize(track.title)} ${primaryArtist(track.artist)}`))
  }

  async writePlaylist(name: string, tracks: Track[]): Promise<string> {
    const { id } = await this.oauth.json<{ id: string }>(`${API}/me/playlists`, {
      method: 'POST',
      body: JSON.stringify({ name, public: false }),
    })
    const uris = tracks.flatMap((t) => (t.ids.spotify ? [`spotify:track:${t.ids.spotify}`] : []))
    for (let i = 0; i < uris.length; i += 100) {
      await this.oauth.json(`${API}/playlists/${id}/items`, {
        method: 'POST',
        body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      })
    }
    return id
  }

  private async all<T>(url: string): Promise<T[]> {
    const out: T[] = []
    for (let next: string | null = url; next; ) {
      const page: Paging<T> = await this.oauth.json<Paging<T>>(next)
      out.push(...page.items)
      next = page.next
    }
    return out
  }
}

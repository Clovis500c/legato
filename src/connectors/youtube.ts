import { bestMatch } from '../core/match'
import { OAuthClient } from '../core/oauth'
import type { Connector, PlaylistRef, SecretStore, Track } from '../core/types'

const API = 'https://www.googleapis.com/youtube/v3'

interface Page<T> {
  items: T[]
  nextPageToken?: string
}

/** Guess artist + title from video. "X - Topic" channel = clean metadata; else "Artist - Title" pattern; else channel. */
export function parseVideo(title: string, channel: string): Pick<Track, 'title' | 'artist'> {
  const topic = channel.match(/^(.+) - Topic$/)
  if (topic) return { artist: topic[1], title }
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dash) return { artist: dash[1], title: dash[2] }
  return { artist: channel.replace(/\s*VEVO$/i, '').replace(/\s*-?\s*Official$/i, ''), title }
}

/** ISO 8601 "PT1H2M3S" → ms. */
export function parseDuration(iso: string): number | undefined {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  return m ? ((+(m[1] ?? 0) * 60 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 1000 : undefined
}

/**
 * YouTube Data API v3. Quota: 10k units/day shared (list = 1, insert = 50); search.list own bucket, 100 calls/day.
 * Google Desktop OAuth client = user's own client id + secret ("bring your key").
 */
export class YouTubeConnector implements Connector {
  readonly source = 'youtube' as const
  private oauth: OAuthClient

  constructor(
    clientId: string,
    clientSecret: string,
    store: SecretStore,
    open: (url: string) => unknown,
    fetchFn: typeof fetch = fetch,
  ) {
    this.oauth = new OAuthClient(
      {
        key: 'youtube',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret,
        scope: 'https://www.googleapis.com/auth/youtube',
        // offline + consent = refresh token every time.
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
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
    const lists = await this.all<{ id: string; snippet: { title: string } }>('playlists', { part: 'snippet', mine: 'true' })
    return lists.map((p) => ({ id: p.id, name: p.snippet.title }))
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const items = await this.all<{
      snippet: { title: string; videoOwnerChannelTitle?: string; resourceId: { videoId: string } }
    }>('playlistItems', { part: 'snippet', playlistId })
    // Deleted/private videos have no owner channel. Skip.
    const videos = items.filter((i) => i.snippet.videoOwnerChannelTitle)
    const durations = await this.durations(videos.map((v) => v.snippet.resourceId.videoId))
    return videos.map(({ snippet: s }) => ({
      ...parseVideo(s.title, s.videoOwnerChannelTitle!),
      durationMs: durations.get(s.resourceId.videoId),
      ids: { youtube: s.resourceId.videoId },
    }))
  }

  /** Costs 1 of 100 daily search calls. No duration (would cost videos.list). */
  async search(query: string): Promise<Track[]> {
    const r = await this.get<Page<{ id: { videoId: string }; snippet: { title: string; channelTitle: string } }>>('search', {
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      maxResults: '10',
      q: query,
    })
    return r.items.map((v) => ({ ...parseVideo(v.snippet.title, v.snippet.channelTitle), ids: { youtube: v.id.videoId } }))
  }

  async resolve(track: Track): Promise<Track | null> {
    return bestMatch(track, await this.search(`${track.artist} ${track.title}`))
  }

  /** 50 units per insert: ~190 tracks/day max. */
  async writePlaylist(name: string, tracks: Track[]): Promise<string> {
    const { id } = await this.oauth.json<{ id: string }>(`${API}/playlists?part=snippet,status`, {
      method: 'POST',
      body: JSON.stringify({ snippet: { title: name }, status: { privacyStatus: 'private' } }),
    })
    for (const t of tracks) {
      if (!t.ids.youtube) continue
      await this.oauth.json(`${API}/playlistItems?part=snippet`, {
        method: 'POST',
        body: JSON.stringify({ snippet: { playlistId: id, resourceId: { kind: 'youtube#video', videoId: t.ids.youtube } } }),
      })
    }
    return id
  }

  private async durations(ids: string[]): Promise<Map<string, number | undefined>> {
    const out = new Map<string, number | undefined>()
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.get<Page<{ id: string; contentDetails: { duration: string } }>>('videos', {
        part: 'contentDetails',
        id: ids.slice(i, i + 50).join(','),
      })
      for (const v of r.items) out.set(v.id, parseDuration(v.contentDetails.duration))
    }
    return out
  }

  private get<T>(path: string, params: Record<string, string>) {
    return this.oauth.json<T>(`${API}/${path}?${new URLSearchParams(params)}`)
  }

  private async all<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = []
    let pageToken: string | undefined
    do {
      const page: Page<T> = await this.get<Page<T>>(path, { ...params, maxResults: '50', ...(pageToken && { pageToken }) })
      out.push(...page.items)
      pageToken = page.nextPageToken
    } while (pageToken)
    return out
  }
}

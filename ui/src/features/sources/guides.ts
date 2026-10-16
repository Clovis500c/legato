import type { Credentials, Service } from '../../shared/api'

export interface Step {
  title: string
  text: string
  link?: { label: string; url: string }
  copy?: string
}

export interface Guide {
  pitch: string
  callout: string
  steps: Step[]
  fields: { key: keyof Credentials; label: string; secret?: boolean; placeholder: string }[]
}

/** "Bring your key" walkthroughs. Checked against provider docs 2026-10; re-check when providers change UI. */
export const guides: Record<Service, Guide> = {
  spotify: {
    pitch: 'Import your playlists and link them to other services. Your own key, 2 minutes.',
    callout: 'Spotify requires the key owner to have Premium, and limits each key to 5 accounts.',
    steps: [
      {
        title: 'Create a Spotify app',
        text: 'Developer dashboard → Create app. Any name and description, tick “Web API”.',
        link: { label: 'Open the Spotify dashboard', url: 'https://developer.spotify.com/dashboard' },
      },
      {
        title: 'Add the redirect address',
        text: 'Under “Redirect URIs”, paste exactly this address (no port), click Add, then Save:',
        copy: 'http://127.0.0.1/callback',
      },
      { title: 'Paste your Client ID', text: 'Your app’s Settings → Client ID. The Client secret is not needed.' },
    ],
    fields: [{ key: 'spotifyClientId', label: 'Client ID', placeholder: 'e.g. 3f9a…7c21e' }],
  },
  youtube: {
    pitch: 'Playlists through the official YouTube API. Your own Google key, free.',
    callout: 'Free quota: 10,000 units a day, plenty to import your playlists.',
    steps: [
      {
        title: 'Create a Google Cloud project',
        text: 'A free project is enough, no credit card needed.',
        link: { label: 'Create a project', url: 'https://console.cloud.google.com/projectcreate' },
      },
      {
        title: 'Enable YouTube Data API v3',
        text: 'In the API library, open “YouTube Data API v3” and click Enable.',
        link: { label: 'Open the API', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      },
      {
        title: 'Set up the consent screen',
        text: 'Type “External”, keep the app in Testing and add your Gmail address as a test user.',
        link: { label: 'Consent screen', url: 'https://console.cloud.google.com/auth/overview' },
      },
      {
        title: 'Create an OAuth client',
        text: 'Credentials → Create credentials → OAuth client ID → type “Desktop app”. Copy the ID and the secret.',
        link: { label: 'Open credentials', url: 'https://console.cloud.google.com/apis/credentials' },
      },
    ],
    fields: [
      { key: 'youtubeClientId', label: 'Client ID', placeholder: '…apps.googleusercontent.com' },
      { key: 'youtubeClientSecret', label: 'Client secret', secret: true, placeholder: 'GOCSPX-…' },
    ],
  },
}

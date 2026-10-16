import type { Credentials } from '../../shared/api'

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

/** Spotify "bring your key" walkthrough (Spotify has no keyless sign-in). Checked 2026-10; re-check when Spotify changes its dashboard. */
export const guides: Record<'spotify', Guide> = {
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
}

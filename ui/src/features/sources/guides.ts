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
    pitch: 'Importe tes playlists et relie-les aux autres services. Ta propre clé, 2 minutes.',
    callout: 'Spotify exige que le propriétaire de la clé ait Premium, et limite chaque clé à 5 comptes.',
    steps: [
      {
        title: 'Crée une app Spotify',
        text: 'Dashboard développeur → Create app. Nom et description libres, coche « Web API ».',
        link: { label: 'Ouvrir le dashboard Spotify', url: 'https://developer.spotify.com/dashboard' },
      },
      {
        title: 'Ajoute l’adresse de retour',
        text: 'Dans « Redirect URIs », colle exactement cette adresse (sans port), clique Add puis Save :',
        copy: 'http://127.0.0.1/callback',
      },
      { title: 'Colle ton Client ID', text: 'Settings de ton app → Client ID. Le Client secret n’est pas nécessaire.' },
    ],
    fields: [{ key: 'spotifyClientId', label: 'Client ID', placeholder: 'ex. 3f9a…7c21e' }],
  },
  youtube: {
    pitch: 'Playlists via l’API officielle YouTube. Ta propre clé Google, gratuite.',
    callout: 'Quota gratuit : 10 000 unités par jour, largement assez pour importer tes playlists.',
    steps: [
      {
        title: 'Crée un projet Google Cloud',
        text: 'Un projet gratuit suffit, aucune carte bancaire requise.',
        link: { label: 'Créer un projet', url: 'https://console.cloud.google.com/projectcreate' },
      },
      {
        title: 'Active YouTube Data API v3',
        text: 'Dans la bibliothèque d’API, ouvre « YouTube Data API v3 » et clique Activer.',
        link: { label: 'Ouvrir l’API', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      },
      {
        title: 'Configure l’écran de consentement',
        text: 'Type « Externe », laisse l’app en mode Test et ajoute ton adresse Gmail comme utilisateur test.',
        link: { label: 'Écran de consentement', url: 'https://console.cloud.google.com/auth/overview' },
      },
      {
        title: 'Crée un identifiant OAuth',
        text: 'Identifiants → Créer → ID client OAuth → type « Application de bureau ». Copie l’ID et le secret.',
        link: { label: 'Ouvrir les identifiants', url: 'https://console.cloud.google.com/apis/credentials' },
      },
    ],
    fields: [
      { key: 'youtubeClientId', label: 'Client ID', placeholder: '…apps.googleusercontent.com' },
      { key: 'youtubeClientSecret', label: 'Client secret', secret: true, placeholder: 'GOCSPX-…' },
    ],
  },
}

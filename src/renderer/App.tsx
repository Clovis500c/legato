import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from './store'

const fmt = (ms?: number) => (ms ? `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '')

function Account(props: {
  name: string
  connected: boolean
  fields: { key: string; label: string; secret?: boolean }[]
  help: ReactNode
  onConnect: (values: Record<string, string>) => void
  onDisconnect: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const busy = useStore((s) => s.busy)
  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-2 font-semibold">
        {props.name} <span className={props.connected ? 'text-green-400' : 'text-neutral-500'}>{props.connected ? '● connecté' : '○ non connecté'}</span>
      </h2>
      {props.connected ? (
        <button className="text-sm text-neutral-400 underline" onClick={props.onDisconnect}>
          Déconnecter
        </button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            props.onConnect(values)
          }}
        >
          <p className="text-xs text-neutral-400">{props.help}</p>
          {props.fields.map((f) => (
            <label key={f.key} className="block text-sm">
              {f.label}
              <input
                type={f.secret ? 'password' : 'text'}
                className="mt-1 block w-full rounded bg-neutral-900 px-2 py-1"
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </label>
          ))}
          <button disabled={busy} className="rounded bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 disabled:opacity-50">
            Connecter (ouvre le navigateur)
          </button>
        </form>
      )}
    </section>
  )
}

export function App() {
  const { status, tracks, playlists, busy, error, report, refresh, run, sync } = useStore()
  useEffect(() => void refresh(), [refresh])

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Music App</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Account
          name="Spotify"
          connected={status.spotify}
          fields={[{ key: 'spotifyClientId', label: 'Client ID' }]}
          help={
            <>
              Crée une app sur developer.spotify.com/dashboard (Web API), ajoute l’URI de redirection <code>http://127.0.0.1/callback</code>,
              puis colle son Client ID. Mode développement : compte Premium requis, 5 utilisateurs max.
            </>
          }
          onConnect={(v) => run(() => window.api.connect('spotify', v))}
          onDisconnect={() => run(() => window.api.disconnect('spotify'))}
        />
        <Account
          name="YouTube"
          connected={status.youtube}
          fields={[
            { key: 'youtubeClientId', label: 'Client ID' },
            { key: 'youtubeClientSecret', label: 'Client secret', secret: true },
          ]}
          help={
            <>
              Dans console.cloud.google.com : active « YouTube Data API v3 », crée un identifiant OAuth de type « Application de bureau ».
              Quota : 10 000 unités/jour.
            </>
          }
          onConnect={(v) => run(() => window.api.connect('youtube', v))}
          onDisconnect={() => run(() => window.api.disconnect('youtube'))}
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={sync}
          disabled={busy || (!status.spotify && !status.youtube)}
          className="rounded bg-green-500 px-4 py-2 font-medium text-neutral-950 disabled:opacity-40"
        >
          {busy ? 'Synchronisation…' : 'Synchroniser'}
        </button>
        {report && (
          <span className="text-sm text-neutral-400">
            {report.playlists} playlists importées, {report.matched} morceaux reliés à Spotify
            {report.errors.length > 0 && `, ${report.errors.length} erreurs`}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {report?.errors.length ? (
        <details className="text-xs text-neutral-500">
          <summary>Détail des erreurs</summary>
          <ul>{report.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      ) : null}

      <section>
        <h2 className="mb-2 font-semibold">
          Bibliothèque · {tracks.length} morceaux · {playlists.length} playlists
        </h2>
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-1">Titre</th>
              <th>Artiste</th>
              <th>Album</th>
              <th>Durée</th>
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id} className="border-t border-neutral-900">
                <td className="py-1">{t.title}</td>
                <td>{t.artist}</td>
                <td className="text-neutral-400">{t.album}</td>
                <td className="text-neutral-400">{fmt(t.durationMs)}</td>
                <td className="space-x-1">
                  {t.ids.spotify && <span className="rounded bg-green-900 px-1 text-xs">Spotify</span>}
                  {t.ids.youtube && <span className="rounded bg-red-900 px-1 text-xs">YouTube</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}

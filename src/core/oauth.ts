import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SecretStore } from './types'

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

export interface OAuthConfig {
  /** SecretStore key for tokens. */
  key: string
  authUrl: string
  tokenUrl: string
  clientId: string
  /** Google Desktop clients need it (not really secret, RFC 8252). Spotify PKCE: none. */
  clientSecret?: string
  scope: string
  extraAuthParams?: Record<string, string>
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** Open auth URL, wait redirect on http://127.0.0.1:<free port>/callback. Dynamic loopback port OK for Spotify + Google. */
export async function loopbackAuthorize(
  buildUrl: (redirectUri: string, state: string) => string,
  open: (url: string) => unknown,
  timeoutMs = 5 * 60_000,
): Promise<{ code: string; redirectUri: string }> {
  const state = randomBytes(16).toString('base64url')
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connexion expirée')), timeoutMs)
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        if (url.pathname !== '/callback') return void res.writeHead(404).end()
        const code = url.searchParams.get('code')
        const ok = code && url.searchParams.get('state') === state
        res
          .writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
          .end(ok ? '<p>Compte connecté. Vous pouvez fermer cet onglet.</p>' : '<p>Échec de la connexion.</p>')
        clearTimeout(timer)
        if (ok) resolve(code)
        else reject(new Error(url.searchParams.get('error') ?? 'Réponse OAuth invalide'))
      })
      open(buildUrl(redirectUri, state))
    })
    return { code, redirectUri }
  } finally {
    server.close()
  }
}

/** Shared OAuth 2 client (code + PKCE): connect, refresh, authed calls. */
export class OAuthClient {
  constructor(
    private cfg: OAuthConfig,
    private store: SecretStore,
    private open: (url: string) => unknown,
    private fetchFn: typeof fetch = fetch,
  ) {}

  isConnected() {
    return !!this.store.get<OAuthTokens>(this.cfg.key)
  }

  async connect() {
    const { verifier, challenge } = pkce()
    const { code, redirectUri } = await loopbackAuthorize(
      (redirect_uri, state) =>
        `${this.cfg.authUrl}?${new URLSearchParams({
          client_id: this.cfg.clientId,
          response_type: 'code',
          redirect_uri,
          state,
          scope: this.cfg.scope,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          ...this.cfg.extraAuthParams,
        })}`,
      this.open,
    )
    await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  }

  disconnect() {
    this.store.set(this.cfg.key, undefined)
  }

  async accessToken(): Promise<string> {
    const t = this.store.get<OAuthTokens>(this.cfg.key)
    if (!t) throw new Error(`Non connecté (${this.cfg.key})`)
    if (Date.now() < t.expiresAt) return t.accessToken
    if (!t.refreshToken) throw new Error(`Session expirée (${this.cfg.key}), reconnectez le compte`)
    return (await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken }, t)).accessToken
  }

  /** Authed JSON call. Honor Retry-After on 429, once. */
  async json<T>(url: string, init: RequestInit = {}, retried = false): Promise<T> {
    const res = await this.fetchFn(url, {
      ...init,
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json', ...init.headers },
    })
    if (res.status === 429 && !retried) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') ?? 1) * 1000))
      return this.json(url, init, true)
    }
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${await res.text()}`)
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  private async tokenRequest(params: Record<string, string>, prev?: OAuthTokens): Promise<OAuthTokens> {
    const body = new URLSearchParams({ ...params, client_id: this.cfg.clientId })
    if (this.cfg.clientSecret) body.set('client_secret', this.cfg.clientSecret)
    const res = await this.fetchFn(this.cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`Échange de token refusé : ${res.status} ${await res.text()}`)
    const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
    const tokens: OAuthTokens = {
      accessToken: j.access_token,
      // Spotify may rotate refresh token. Google never resends it.
      refreshToken: j.refresh_token ?? prev?.refreshToken,
      expiresAt: Date.now() + (j.expires_in - 60) * 1000,
    }
    this.store.set(this.cfg.key, tokens)
    return tokens
  }
}

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fakeFetch, memoryStore } from '../connectors/testing'
import { OAuthClient, loopbackAuthorize, pkce, type OAuthConfig } from './oauth'

const cfg: OAuthConfig = {
  key: 'svc',
  authUrl: 'https://auth.example/authorize',
  tokenUrl: 'https://auth.example/token',
  clientId: 'CID',
  scope: 'read',
}

// Fake browser: user approves, provider redirects to loopback with code + state.
const approve = (code: string) => (url: string) => {
  const u = new URL(url)
  const back = new URL(u.searchParams.get('redirect_uri')!)
  back.search = new URLSearchParams({ code, state: u.searchParams.get('state')! }).toString()
  void fetch(back)
}

describe('pkce', () => {
  it('challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = pkce()
    expect(verifier).toMatch(/^[\w-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('loopbackAuthorize', () => {
  it('reçoit le code sur 127.0.0.1 avec un port dynamique', async () => {
    const r = await loopbackAuthorize((redirect, state) => `https://x/?redirect_uri=${redirect}&state=${state}`, approve('C1'))
    expect(r.code).toBe('C1')
    expect(r.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  it('rejette un state invalide', async () => {
    const forged = (url: string) => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri')!)
      void fetch(`${back}?code=C&state=forged`)
    }
    await expect(loopbackAuthorize((r, s) => `https://x/?redirect_uri=${r}&state=${s}`, forged)).rejects.toThrow()
  })

  it('rejette un refus utilisateur', async () => {
    const deny = (url: string) => void fetch(`${new URL(url).searchParams.get('redirect_uri')}?error=access_denied`)
    await expect(loopbackAuthorize((r) => `https://x/?redirect_uri=${r}`, deny)).rejects.toThrow('access_denied')
  })
})

describe('OAuthClient', () => {
  it('connect : échange le code avec le verifier PKCE et stocke les tokens', async () => {
    let challenge = ''
    const store = memoryStore()
    const f = fakeFetch({ 'POST auth.example/token': { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } })
    const open = (url: string) => {
      challenge = new URL(url).searchParams.get('code_challenge')!
      approve('CODE')(url)
    }
    await new OAuthClient(cfg, store, open, f).connect()
    const body = new URLSearchParams(f.calls[0].body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('CODE')
    expect(body.get('client_id')).toBe('CID')
    expect(body.has('client_secret')).toBe(false)
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge)
    expect(store.data.svc).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' })
  })

  it('rafraîchit un token expiré et garde le refresh token si non renvoyé', async () => {
    const store = memoryStore({ svc: { accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 } })
    const f = fakeFetch({ 'POST auth.example/token': { access_token: 'NEW', expires_in: 3600 } })
    const client = new OAuthClient({ ...cfg, clientSecret: 'S' }, store, () => {}, f)
    expect(await client.accessToken()).toBe('NEW')
    const body = new URLSearchParams(f.calls[0].body)
    expect([body.get('grant_type'), body.get('refresh_token'), body.get('client_secret')]).toEqual(['refresh_token', 'RT', 'S'])
    expect(store.data.svc).toMatchObject({ accessToken: 'NEW', refreshToken: 'RT' })
  })

  it('réessaie une fois après un 429', async () => {
    let n = 0
    const f = fakeFetch({
      'GET api.example/x': () => (n++ ? { ok: 1 } : new Response('', { status: 429, headers: { 'retry-after': '0' } })),
    })
    const store = memoryStore({ svc: { accessToken: 'AT', expiresAt: Date.now() + 60_000 } })
    expect(await new OAuthClient(cfg, store, () => {}, f).json('https://api.example/x')).toEqual({ ok: 1 })
    expect(f.calls).toHaveLength(2)
  })
})

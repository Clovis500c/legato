import type { SecretStore } from '../core/types'

export function memoryStore(init: Record<string, unknown> = {}): SecretStore & { data: Record<string, unknown> } {
  const data = { ...init }
  return { data, get: <T>(k: string) => data[k] as T | undefined, set: (k, v) => void (data[k] = v) }
}

export const validTokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 }

type Handler = (url: URL, init: RequestInit) => unknown

/** Fake fetch. Route key "METHOD host/path" → JSON, Response, or handler. Calls logged in `calls`. */
export function fakeFetch(routes: Record<string, unknown | Handler>) {
  const calls: { method: string; url: URL; body?: string }[] = []
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    calls.push({ method, url, body: init.body?.toString() })
    const key = `${method} ${url.host}${url.pathname}`
    if (!(key in routes)) return new Response(`no route ${key}`, { status: 404 })
    const r = routes[key]
    const out = typeof r === 'function' ? (r as Handler)(url, init) : r
    return out instanceof Response ? out : Response.json(out)
  }) as typeof fetch
  return Object.assign(fn, { calls })
}

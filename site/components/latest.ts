'use client'

import { useEffect, useState } from 'react'
import { GITHUB } from './content'

const RELEASES = `${GITHUB}/releases/latest`
type Latest = { href: string; version: string | null }
type Release = { tag_name: string; assets: { name: string; browser_download_url: string }[] }

// One request per visit, shared by every download button.
let pending: Promise<Latest> | null = null
const latest = () =>
  (pending ??= fetch('https://api.github.com/repos/Clovis500c/legato/releases/latest')
    .then((r) => (r.ok ? (r.json() as Promise<Release>) : Promise.reject(new Error(String(r.status)))))
    .then((r) => ({ href: r.assets.find((a) => a.name.endsWith('-setup.exe'))?.browser_download_url ?? RELEASES, version: r.tag_name.replace(/^v/, '') }))
    .catch(() => ({ href: RELEASES, version: null })))

type Android = { href: string; version: string | null }
let pendingApk: Promise<Android> | null = null
// The APK is attached to every Beta (a prerelease), so Stable's "latest" may have none: the newest release that has one.
const apk = () =>
  (pendingApk ??= fetch('https://api.github.com/repos/Clovis500c/legato/releases?per_page=10')
    .then((r) => (r.ok ? (r.json() as Promise<Release[]>) : Promise.reject(new Error(String(r.status)))))
    .then((all) => {
      for (const r of all) {
        const a = r.assets.find((x) => x.name.endsWith('_android-arm64.apk'))
        if (a) return { href: a.browser_download_url, version: r.tag_name.replace(/^v/, '') }
      }
      return { href: RELEASES, version: null }
    })
    .catch(() => ({ href: RELEASES, version: null })))

/** The newest Android APK straight from GitHub; the releases page until GitHub answers, or if none has one. */
export function useAndroid(): Android {
  const [l, setL] = useState<Android>({ href: RELEASES, version: null })
  useEffect(() => {
    let live = true
    void apk().then((x) => live && setL(x))
    return () => {
      live = false
    }
  }, [])
  return l
}

/** The latest installer straight from GitHub; its releases page until GitHub answers, or if it doesn't. */
export function useLatest(): Latest {
  const [l, setL] = useState<Latest>({ href: RELEASES, version: null })
  useEffect(() => {
    let live = true
    void latest().then((x) => live && setL(x))
    return () => {
      live = false
    }
  }, [])
  return l
}

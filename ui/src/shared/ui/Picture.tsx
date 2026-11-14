import { useState } from 'react'
import { remoteArt } from '../art'

/** A picture from a remote host through the `art` scheme (the front end never fetches); any failure (offline, a removed picture) shows `fallback`. */
export function Picture({ url, className, fallback }: { url: string | null; className: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false)
  return url && !failed ? <img src={remoteArt(url)} alt="" draggable={false} onError={() => setFailed(true)} className={className} /> : <>{fallback}</>
}

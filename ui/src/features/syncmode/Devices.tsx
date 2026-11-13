import { ArrowsClockwise, Devices as DevicesGlyph, Plus, ShieldCheck, Trash } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { api, type DeviceOffer, type DevicesStatus, type Merged, type SyncDeviceRow } from '../../shared/api'
import { timeAgo } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import { phoneApp } from '../../shared/platform'
import { Button } from '../../shared/ui/Button'
import { onMenu } from '../../shared/ui/ContextMenu'
import { Toggle } from '../../shared/ui/controls'
import { Dialog } from '../../shared/ui/Dialog'
import { qrPath } from '../share/qr'
import { scanWebcam } from '../share/webcam'
import { DeviceIcon } from './DeviceIcon'
import { kindLabel, left, rowNote, typedCode } from './devicesView'
import { mergedText } from './merged'

const fail = (e: unknown) => useStore.getState().notify(String(e), { kind: 'error' })

/** Nothing new from it: said here. Changes are told by the `sync` event. */
function done(m: Merged, text: string) {
  if (!mergedText(m)) useStore.getState().notify(text, { kind: 'ok' })
}

function Row({ r, busy, onSync, onPair, onForget }: { r: SyncDeviceRow; busy: boolean; onSync: () => void; onPair: () => void; onForget: () => void }) {
  const kind = kindLabel(r.os, r.form)
  const ok = r.trusted && !r.refused
  const menu = onMenu(() => [
    ok && r.here && { label: tr('Sync now'), icon: <ArrowsClockwise size={16} />, onSelect: onSync },
    !ok && { label: tr('Pair'), icon: <Plus size={16} />, onSelect: onPair },
    r.trusted && { label: tr('Forget this device'), icon: <Trash size={16} />, danger: true, onSelect: onForget },
  ])
  return (
    <li onContextMenu={menu} className="flex items-center gap-3 border-t border-line-soft py-2.5">
      <DeviceIcon os={r.os} form={r.form} here={r.here} label={kind} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
          <span className="truncate">{r.name}</span>
          {ok && <ShieldCheck size={13} weight="fill" className="shrink-0 text-ink-3" aria-hidden />}
        </span>
        <span className="line-clamp-2 text-xs text-ink-2">
          {kind} · {rowNote(r, timeAgo)}
        </span>
      </span>
      {ok ? (
        <>
          {r.here && (
            <Button variant="ghost" disabled={busy} onClick={onSync} title={tr('Sync now')}>
              <ArrowsClockwise size={14} className={busy ? 'animate-spin' : ''} /> <span className="max-sm:sr-only">{tr('Sync now')}</span>
            </Button>
          )}
          <Button variant="ghost" onClick={onForget} title={tr('Forget this device')} aria-label={tr('Forget this device')}>
            <Trash size={14} />
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={onPair}>
          {tr('Pair')}
        </Button>
      )}
    </li>
  )
}

/** Add a device: a code and its QR code shown here, or the code another device shows typed here. */
function AddDevice({ mode: first, name, onClose }: { mode: 'show' | 'enter'; name?: string; onClose: () => void }) {
  const [mode, setMode] = useState(first)
  const [trust, setTrust] = useState(true)
  const [offer, setOffer] = useState<DeviceOffer | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  // A code while this shows it; a new one when trust changes. Closed with the dialog.
  useEffect(() => {
    if (mode !== 'show') return
    let live = true
    let code: string | null = null
    setOffer(null)
    setError(undefined)
    api.deviceOffer(trust).then(
      (o) => {
        if (live) {
          code = o.code
          setNow(Date.now())
          setOffer(o)
        } else void api.deviceOfferStop(o.code)
      },
      (e) => live && setError(String(e)),
    )
    const off = api.onDeviceOffer((r) => {
      if ('Ok' in r) {
        useStore.getState().notify(tr('Paired and synced'), { kind: 'ok' })
        close.current()
      } else {
        setOffer(null)
        setError(r.Err)
      }
    })
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      live = false
      clearInterval(tick)
      void off.then((f) => f())
      if (code) void api.deviceOfferStop(code)
    }
  }, [mode, trust])
  const target = typedCode(typed)
  const pair = async (to = target) => {
    if (!to) return
    setBusy(true)
    setError(undefined)
    try {
      await api.devicePair(to.code, to.link, trust)
      useStore.getState().notify(tr('Paired and synced'), { kind: 'ok' })
      close.current()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const webcam = useSettings((s) => s.settings.webcamScan)
  // The phone's camera, or the webcam when that setting is on: the other device's QR code carries the whole pairing link.
  const scan = async () => {
    try {
      const text = await (phoneApp ? api.scanQr() : scanWebcam())
      const to = text ? typedCode(text) : null
      if (to) await pair(to)
      else if (text) setError(tr('Not a Legato pairing code'))
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <Dialog title={tr('Add a device')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1 text-[0.8125rem]">
          {(['show', 'enter'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 transition ${mode === m ? 'bg-raised font-medium shadow-[0_1px_2px_var(--shadow)]' : 'text-ink-2 hover:text-ink'}`}>
              {m === 'show' ? tr('Show a code') : tr('Enter a code')}
            </button>
          ))}
        </div>
        {mode === 'show'
          ? offer && (
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                {offer.qr && (
                  // Black on white whatever the theme: scanners need it.
                  <svg viewBox={`0 0 ${offer.qr[0] + 8} ${offer.qr[0] + 8}`} shapeRendering="crispEdges" role="img" aria-label={tr('QR code to pair a device')} className="size-40 shrink-0 rounded-lg">
                    <rect width="100%" height="100%" fill="#FFFFFF" />
                    <path d={qrPath(offer.qr[0], offer.qr[1], 4)} fill="#000000" />
                  </svg>
                )}
                <div className="flex flex-col gap-2 text-center sm:text-start">
                  <span className="font-mono text-4xl tracking-[0.2em] tabular-nums">{offer.code}</span>
                  <p className="text-xs text-ink-2">{tr('Type it on the other device (Settings › Sync Mode › Add a device › Enter a code), or scan the QR code with Legato on a phone.')}</p>
                  <p className="text-xs text-ink-3">{tr('Closes in {time}', { time: left(offer.until, now) })}</p>
                </div>
              </div>
            )
          : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void pair()
                }}
              >
                {name && <p className="text-xs text-ink-2">{tr('On {name}: Settings › Sync Mode › Add a device › Show a code.', { name })}</p>}
                <div className="flex gap-2">
                  <input autoFocus inputMode="numeric" autoComplete="off" aria-label={tr('Code from the other device')} placeholder="000000" value={typed} onChange={(e) => setTyped(e.target.value)} className="w-40 min-w-0 rounded-md border border-line bg-bg px-3 py-2 font-mono text-lg tracking-[0.2em] outline-none focus:border-ink-3" />
                  <Button type="submit" disabled={!target || busy}>
                    {busy ? tr('Syncing…') : tr('Pair')}
                  </Button>
                </div>
                {(phoneApp || webcam) && (
                  <Button variant="ghost" onClick={() => void scan()} disabled={busy}>
                    {phoneApp ? tr('Scan a QR code') : tr('Scan with the webcam')}
                  </Button>
                )}
              </form>
            )}
        <div className="flex items-start gap-3 text-xs">
          <Toggle checked={trust} onChange={setTrust} label={tr('Trust this device')} />
          <span>
            <span className="font-medium">{tr('Trust this device')}</span> <span className="text-ink-2">{tr('No code next time: the two sync on their own whenever they share a network.')}</span>
          </span>
        </div>
        {error && <p className="text-xs text-[#F23F43]">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Settings › Sync Mode › Your devices: this one, the trusted ones (here or not), the others heard here; pairing. */
export function Devices() {
  const [s, setS] = useState<DevicesStatus | null>(null)
  const [adding, setAdding] = useState<{ mode: 'show' | 'enter'; name?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = useCallback(() => void api.devicesStatus().then(setS, () => {}), [])
  useEffect(() => {
    refresh()
    // "Here" ages out without an event.
    const id = setInterval(refresh, 10_000)
    const off = api.onDevices(refresh)
    return () => {
      clearInterval(id)
      void off.then((f) => f())
    }
  }, [refresh])
  const closeAdd = useCallback(() => {
    setAdding(null)
    refresh()
  }, [refresh])
  if (!s) return null
  const sync = async (r: SyncDeviceRow) => {
    setBusy(r.id)
    try {
      done(await api.deviceSync(r.id), tr('Up to date with {name}', { name: r.name }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
      refresh()
    }
  }
  const row = (r: SyncDeviceRow) => <Row key={r.id} r={r} busy={busy === r.id} onSync={() => void sync(r)} onPair={() => setAdding({ mode: 'enter', name: r.name })} onForget={() => void api.deviceForget(r.id).then(refresh, fail)} />
  const trusted = s.rows.filter((r) => r.trusted)
  const nearby = s.rows.filter((r) => !r.trusted)
  const kind = kindLabel(s.os, s.form)
  return (
    <section data-setting="Your devices" className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4">
      <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold">
        <DevicesGlyph size={16} /> <span className="flex-1">{tr('Your devices')}</span>
        <span className="text-xs font-normal text-ink-2 max-sm:sr-only">{tr('Sync over the network')}</span>
        <Toggle checked={s.network} onChange={(on) => void api.devicesNetwork(on).then(refresh, fail)} label={tr('Sync over the network')} />
      </h2>
      <p className="text-xs text-ink-2">{tr('Phones and PCs with Legato on the same Wi-Fi sync everything with each other: paired once with a code or a QR code, then on their own. Nothing goes through the internet.')}</p>
      <ul className="flex flex-col">
        <li className="flex items-center gap-3 pb-2.5">
          <DeviceIcon os={s.os} form={s.form} label={kind} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[0.8125rem] font-medium">{s.name}</span>
            <span className="line-clamp-2 text-xs text-ink-2">
              {tr('This device')} · {kind}
            </span>
          </span>
        </li>
        {trusted.map(row)}
      </ul>
      {s.network && nearby.length > 0 && (
        <>
          <h3 className="pt-1 text-[0.6875rem] font-semibold tracking-wide text-ink-3 uppercase">{tr('Nearby')}</h3>
          <ul className="flex flex-col">{nearby.map(row)}</ul>
        </>
      )}
      {!s.network && <p className="text-xs text-ink-2">{tr('Off: this device isn’t seen by your other devices, and doesn’t sync with them.')}</p>}
      {s.error && <p className="text-xs text-[#F23F43]">{s.error}</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button onClick={() => setAdding({ mode: 'show' })}>
          <Plus size={14} /> {tr('Add a device')}
        </Button>
        {trusted.length > 0 && (
          <span className="flex items-center gap-2 text-xs text-ink-2">
            <Toggle checked={s.auto} onChange={(on) => void api.devicesAuto(on).then(refresh, fail)} label={tr('Sync automatically when they’re on this network')} />
            {tr('Sync automatically when they’re on this network')}
          </span>
        )}
      </div>
      {adding && <AddDevice mode={adding.mode} name={adding.name} onClose={closeAdd} />}
    </section>
  )
}

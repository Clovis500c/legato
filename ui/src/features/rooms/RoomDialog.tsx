import { ArrowClockwise, QrCode, UsersThree } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api, type RoomHeard, type RoomReaction, type RoomStatus } from '../../shared/api'
import { tr, trn } from '../../shared/i18n/i18n'
import { phoneApp } from '../../shared/platform'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { qrPath } from '../share/qr'
import { closeRoom, REACTIONS, useRoom } from './room'
import { RoomFloats } from './RoomPill'
import { catchUp, endRoom, joinRoom, leaveRoom, react, roomError, startRoom } from './rooms'

/** Each reaction's name, for screen readers and tooltips. */
function reactionName(r: RoomReaction): string {
  const names: Record<RoomReaction, string> = { heart: tr('Love it'), fire: tr('Fire'), laugh: tr('Funny'), clap: tr('Applause'), party: tr('Party'), wow: tr('Wow') }
  return names[r]
}

/** The row of reactions: each one floats over the cover, here and for everyone in the room. */
function Reactions() {
  return (
    <div className="relative flex flex-wrap items-center gap-1.5" role="group" aria-label={tr('Reactions')}>
      {/* Over the dialog too: the cover's own floats sit under its backdrop. */}
      <RoomFloats />
      {REACTIONS.map(([r, e]) => (
        <button key={r} type="button" title={reactionName(r)} aria-label={reactionName(r)} onClick={() => react(r)} className="grid size-10 place-items-center rounded-full border border-line text-lg transition hover:bg-raised active:scale-90">
          {e}
        </button>
      ))}
    </div>
  )
}

function People({ s }: { s: RoomStatus }) {
  const names = s.role === 'listener' ? [s.host, ...s.people] : s.people
  return (
    <div className="flex flex-col gap-2">
      <span className="kicker">{s.people.length ? trn(s.people.length, '{n} listening', '{n} listening') : tr('Nobody listening yet')}</span>
      {names.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {names.map((n, i) => (
            <li key={`${n}-${i}`} className="rounded-full bg-raised px-3 py-1 text-xs">
              {n}
              {s.role === 'listener' && i === 0 && <span className="text-ink-3"> · {tr('host')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Hosting({ s }: { s: RoomStatus }) {
  const code = s.code ?? ''
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 phone:flex-col phone:items-stretch">
        <div className="flex flex-col gap-1.5">
          <span className="kicker">{tr('Room code')}</span>
          <span className="font-mono text-[2.5rem] leading-none tracking-[0.12em] tabular-nums" aria-label={code.split('').join(' ')}>
            {code.slice(0, 3)} {code.slice(3)}
          </span>
          <p className="max-w-64 text-xs text-ink-2">{tr('On the other device: Listen together › Join a room, then this code, or scan it with Legato on a phone.')}</p>
        </div>
        {s.qr && (
          // Black on white whatever the theme: scanners need it.
          <svg viewBox={`0 0 ${s.qr[0] + 8} ${s.qr[0] + 8}`} shapeRendering="crispEdges" role="img" aria-label={tr('QR code of the room')} className="w-36 shrink-0 self-center rounded-lg">
            <rect width="100%" height="100%" fill="#FFFFFF" />
            <path d={qrPath(s.qr[0], s.qr[1], 4)} fill="#000000" />
          </svg>
        )}
      </div>
      <People s={s} />
      <Reactions />
      <p className="text-xs text-ink-2">{tr('Friends hear what plays here, each from their own source: YouTube, Spotify or their own files. No sound is sent, only the song and where it is, sealed with the code.')}</p>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => void endRoom().then(closeRoom)}>
          {tr('End room')}
        </Button>
      </div>
    </div>
  )
}

function Listening({ s }: { s: RoomStatus }) {
  const { missing, own, finding } = useRoom()
  const song = s.now?.song
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-line px-4 py-3">
        <span className="kicker">{tr('Playing in the room')}</span>
        {song ? (
          <>
            <span className="truncate text-sm font-medium">{song.title}</span>
            <span className="truncate text-xs text-ink-2">{song.artist}</span>
          </>
        ) : (
          <span className="text-sm text-ink-2">{tr('Nothing playing')}</span>
        )}
        {finding && <span className="text-xs text-ink-2">{tr('Looking for this song…')}</span>}
        {missing && <span className="text-xs text-ink-2">{tr('Can’t find this song here. The room goes on: the next one plays.')}</span>}
      </div>
      {own && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-raised px-4 py-3">
          <span className="text-xs">{tr('Paused here. The room goes on.')}</span>
          <Button variant="accent" className="px-3! py-1.5!" onClick={catchUp}>
            {tr('Catch up')}
          </Button>
        </div>
      )}
      <People s={s} />
      <Reactions />
      <p className="text-xs text-ink-2">{tr('The host picks the songs; each one plays here from your own source. You can pause on your own.')}</p>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => void leaveRoom().then(closeRoom)}>
          {tr('Leave')}
        </Button>
      </div>
    </div>
  )
}

const digits = (t: string) => t.replace(/\D/g, '').slice(0, 6)

function Off() {
  const [rooms, setRooms] = useState<RoomHeard[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const look = () => {
    setRooms(null)
    api
      .roomsNearby()
      .then((r) => {
        setRooms(r)
        setPick((p) => (p && r.some((x) => x.id === p) ? p : (r.find((x) => !x.full)?.id ?? null)))
      })
      .catch(() => setRooms([]))
  }
  useEffect(look, [])
  const join = async (link: string | null = null) => {
    setBusy(true)
    setError(undefined)
    try {
      await joinRoom(link ? null : pick, link, code)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const scan = async () => {
    try {
      const text = await api.scanQr()
      if (text?.startsWith('legato://room?')) await join(text)
      else if (text) setError(tr('Not a Legato room code'))
    } catch (e) {
      setError(roomError(e))
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-ink-2">{tr('Friends on the same Wi-Fi follow what plays here, each from their own source. No sound is sent, no server: the local network only.')}</p>
      <Button variant="accent" className="w-fit" onClick={() => void startRoom()}>
        <UsersThree size={16} /> {tr('Start a room')}
      </Button>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="kicker">{tr('Join a room')}</span>
          <button type="button" onClick={look} disabled={rooms === null} title={tr('Look again')} aria-label={tr('Look again')} className="grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-raised hover:text-ink disabled:opacity-40">
            <ArrowClockwise size={15} className={rooms === null ? 'animate-spin motion-reduce:animate-none' : ''} />
          </button>
        </div>
        {rooms === null ? (
          <p className="text-xs text-ink-2">{tr('Looking for rooms on this network…')}</p>
        ) : rooms.length === 0 ? (
          <p className="text-xs text-ink-2">{tr('No room on this network. Is the other device on the same Wi-Fi, with its room started?')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label={tr('Rooms nearby')}>
            {rooms.map((r) => (
              <li key={r.id}>
                <button type="button" role="radio" aria-checked={pick === r.id} disabled={r.full} onClick={() => setPick(r.id)} className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-start transition disabled:opacity-50 ${pick === r.id ? 'border-ink' : 'border-line hover:bg-raised'}`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{tr('{name}’s room', { name: r.host })}</span>
                    <span className="text-xs text-ink-2">{r.full ? tr('Full') : trn(r.people, '{n} listening', '{n} listening')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(digits(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && pick && void join()}
            inputMode="numeric"
            autoComplete="off"
            placeholder={tr('6-digit code')}
            aria-label={tr('Room code')}
            className="h-10 w-40 min-w-0 rounded-[9px] border border-line bg-raised px-3 font-mono text-base tracking-[0.2em] tabular-nums outline-none placeholder:font-sans placeholder:text-sm placeholder:tracking-normal focus:border-ink"
          />
          <Button variant="primary" disabled={busy || code.length !== 6 || !pick} onClick={() => void join()}>
            {tr('Join')}
          </Button>
          {phoneApp && (
            <Button variant="ghost" disabled={busy} onClick={() => void scan()}>
              <QrCode size={16} /> {tr('Scan')}
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-[#F23F43]">{error}</p>}
      </div>
    </div>
  )
}

/** Listen together on the local network: start a room or join one, or the room you're in (its code, who listens,
 *  reactions, End room / Leave). */
export function RoomDialog() {
  const s = useRoom((x) => x.status)
  const title = !s || s.role === 'off' ? tr('Listen together') : tr('{name}’s room', { name: s.host })
  const kicker = s?.role === 'host' ? tr('Your room') : s?.role === 'listener' ? tr('You follow this room') : tr('Same network')
  return (
    <Dialog title={title} kicker={kicker} onClose={closeRoom}>
      {s?.role === 'host' ? <Hosting s={s} /> : s?.role === 'listener' ? <Listening s={s} /> : <Off />}
    </Dialog>
  )
}

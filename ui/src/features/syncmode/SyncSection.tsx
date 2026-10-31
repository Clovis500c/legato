import { ArrowsClockwise, Cloud, Copy, Desktop, Eye, EyeSlash, FolderOpen, Sparkle, LockSimple, LockSimpleOpen, WifiHigh } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../../app/store'
import { api, type SyncProbe, type SyncStatus } from '../../shared/api'
import { timeAgo } from '../../shared/format'
import { tr } from '../../shared/i18n/i18n'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { mergedText } from './merged'
import { passphrase, strength, type Hint } from './strength'

const MIN_PASSWORD = 10

function Card({ setting, title, icon, children }: { setting: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section data-setting={setting} className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4">
      <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold">
        {icon} {title}
      </h2>
      {children}
    </section>
  )
}

const LEVELS = [
  { label: () => tr('Too short'), color: '#F23F43' },
  { label: () => tr('Weak'), color: '#F23F43' },
  { label: () => tr('Fair'), color: '#F0A020' },
  { label: () => tr('Strong'), color: '#7CC24A' },
  { label: () => tr('Very strong'), color: '#23A55A' },
]
const HINTS: Record<Hint, () => string> = {
  longer: () => tr('add characters (16 or more)'),
  lower: () => tr('add lowercase letters'),
  upper: () => tr('add capital letters'),
  digit: () => tr('add numbers'),
  symbol: () => tr('add symbols (- ! ? # …)'),
  repeats: () => tr('avoid repeated characters'),
  common: () => tr('avoid common words and sequences (password, azerty, 1234…)'),
}

/** Strength bar + what to add. Tip: a few unrelated words joined by symbols beat short gibberish. */
function Meter({ password }: { password: string }) {
  const { level, hints } = strength(password, MIN_PASSWORD)
  const { label, color } = LEVELS[level]
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1 flex-1 rounded-full bg-line" style={i <= Math.max(level, 1) && password ? { background: color } : undefined} />
        ))}
      </div>
      {password && (
        <p className="text-xs">
          <span className="font-medium" style={{ color }}>
            {tr('Strength: {level}', { level: label() })}
          </span>
          {hints.length > 0 && <span className="text-ink-2"> · {tr('To improve: {hints}', { hints: hints.map((h) => HINTS[h]()).join(', ') })}</span>}
        </p>
      )}
      {!password && <p className="text-xs text-ink-2">{tr('Tip: three or four unrelated words joined by symbols and numbers, like Velvet-7-Harbor!Lamp.')}</p>}
    </div>
  )
}

const note = (text: string) => <p className="text-xs text-ink-2">{text}</p>

/** Changes are told by startSyncMode (they come as an event); here only "nothing new". */
function done(m: Awaited<ReturnType<typeof api.syncNow>>) {
  if (!mergedText(m)) useStore.getState().notify(tr('Up to date with your other PCs'), { kind: 'ok' })
}

/** Setting up a folder: new (password or not, the user's choice) or joined (the other PC's choice holds). */
function Setup({ folder, onClose, onDone }: { folder: string; onClose: () => void; onDone: () => void }) {
  const [probe, setProbe] = useState<SyncProbe | null>(null)
  const [protect, setProtect] = useState(true)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    api
      .syncProbe(folder)
      .then(setProbe)
      .catch((e) => setError(String(e)))
  }, [folder])
  const joining = !!probe?.exists
  const needs = joining ? probe.protected : protect
  const ready = !needs || (joining ? password.length > 0 : password.length >= MIN_PASSWORD && password === again)
  const start = async () => {
    setBusy(true)
    setError(undefined)
    try {
      done(await api.syncSetup(folder, needs ? password : null))
      onDone()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const field = (value: string, set: (v: string) => void, label: string) => (
    <div className="relative flex">
      <input
        type={shown ? 'text' : 'password'}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          setCaps(e.getModifierState('CapsLock'))
          if (e.key === 'Enter' && probe && ready && !busy) void start()
        }}
        onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
        className="flex-1 rounded-md border border-line bg-bg py-2 pr-9 pl-3 text-sm outline-none focus:border-ink-3"
      />
      <button type="button" aria-label={shown ? tr('Hide password') : tr('Show password')} title={shown ? tr('Hide password') : tr('Show password')} onClick={() => setShown(!shown)} className="absolute inset-y-0 right-0 px-2.5 text-ink-2 hover:text-ink">
        {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
  const generate = () => {
    const p = passphrase()
    setPassword(p)
    setAgain(p)
    setShown(true)
  }
  const copy = () => void navigator.clipboard.writeText(password).then(() => useStore.getState().notify(tr('Copied to clipboard'), { kind: 'ok' }))
  const choice = (on: boolean, title: string, sub: string, icon: ReactNode) => (
    <button role="radio" aria-checked={protect === on} onClick={() => setProtect(on)} className={`flex gap-3 rounded-lg border p-3 text-left transition ${protect === on ? 'border-ink bg-bg' : 'border-line hover:bg-bg'}`}>
      <span className="mt-0.5">{icon}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[0.8125rem] font-semibold">{title}</span>
        <span className="text-xs text-ink-2">{sub}</span>
      </span>
    </button>
  )
  return (
    <Dialog title={joining ? tr('Join your other PCs') : tr('Sync through this folder')} kicker={folder} onClose={onClose}>
      {!probe && !error && <p className="text-sm text-ink-2">{tr('Looking at the folder…')}</p>}
      {probe && joining && (
        <p className="text-sm text-ink-2">
          {probe.protected ? tr('Another PC already syncs here, protected by a password. Enter the same password:') : tr('Another PC already syncs here without a password: anyone who can open this OneDrive can read your library and settings.')}
        </p>
      )}
      {probe && !joining && (
        <div role="radiogroup" aria-label={tr('Protect the files with a password?')} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{tr('Protect the files with a password?')}</p>
          {choice(true, tr('With a password (recommended)'), tr('Only your PCs can read the files. Your Spotify app ID and Music Detector token travel too, sealed.'), <LockSimple size={16} />)}
          {choice(false, tr('Without a password'), tr('Anyone who can open this OneDrive can read your library and settings. Sign-ins don’t travel: you sign in again on each PC.'), <LockSimpleOpen size={16} />)}
        </div>
      )}
      {probe && needs && (
        <div className="flex flex-col gap-2">
          {field(password, setPassword, tr('Password'))}
          {caps && <p className="text-xs text-[#F0A020]">{tr('Caps Lock is on.')}</p>}
          {!joining && <Meter password={password} />}
          {!joining && field(again, setAgain, tr('Same password again'))}
          {!joining && again && again !== password && <p className="text-xs text-[#F23F43]">{tr('The two passwords don’t match.')}</p>}
          {!joining && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={generate}>
                <Sparkle size={14} /> {tr('Generate one')}
              </Button>
              <Button variant="ghost" disabled={!password} onClick={copy}>
                <Copy size={14} /> {tr('Copy')}
              </Button>
            </div>
          )}
          {!joining && <p className="text-xs text-ink-3">{tr('At least {n} characters. It can’t be recovered: without it, set up a new folder.', { n: MIN_PASSWORD })}</p>}
        </div>
      )}
      {error && <p className="text-sm text-[#F23F43]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {tr('Cancel')}
        </Button>
        <Button disabled={!probe || !ready || busy} onClick={() => void start()}>
          {busy ? tr('Syncing…') : joining ? tr('Join') : tr('Start syncing')}
        </Button>
      </div>
    </Dialog>
  )
}

/** Local network: one PC shows a code, the other types it; both end up with everything. */
function Network({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!code) return
    const off = api.onSyncOffer((r) => {
      setCode(null)
      if ('Ok' in r) {
        done(r.Ok)
        onDone()
      } else setError(r.Err)
    })
    return () => void off.then((f) => f())
  }, [code, onDone])
  const show = async () => {
    setError(undefined)
    try {
      setCode(await api.syncOffer())
    } catch (e) {
      setError(String(e))
    }
  }
  const join = async () => {
    setBusy(true)
    setError(undefined)
    try {
      done(await api.syncJoin(typed))
      setTyping(false)
      setTyped('')
      onDone()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card setting="Sync over the network" title={tr('Sync over the network')} icon={<WifiHigh size={16} />}>
      {note(tr('Two PCs on the same network swap everything at once, sealed with a 6-digit code. Nothing goes through the internet.'))}
      {code ? (
        <div className="flex items-center gap-4">
          <span className="font-mono text-3xl tracking-[0.2em] tabular-nums">{code}</span>
          <span className="flex-1 text-xs text-ink-2">{tr('Type this code on your other PC (Settings › Sync Mode). Waiting for it…')}</span>
          <Button variant="ghost" onClick={() => void api.syncOfferStop().then(() => setCode(null))}>
            {tr('Cancel')}
          </Button>
        </div>
      ) : typing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void join()
          }}
        >
          <input autoFocus inputMode="numeric" maxLength={6} aria-label={tr('Code from the other PC')} placeholder="000000" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))} className="w-32 rounded-md border border-line bg-bg px-3 py-2 font-mono text-lg tracking-[0.2em] outline-none focus:border-ink-3" />
          <Button type="submit" disabled={typed.length !== 6 || busy}>
            {busy ? tr('Syncing…') : tr('Sync')}
          </Button>
          <Button variant="ghost" type="button" onClick={() => setTyping(false)}>
            {tr('Cancel')}
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void show()}>
            {tr('Show a code')}
          </Button>
          <Button variant="ghost" onClick={() => setTyping(true)}>
            {tr('Enter a code')}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-[#F23F43]">{error}</p>}
    </Card>
  )
}

/** Settings › Sync. */
export function SyncSection() {
  const [s, setS] = useState<SyncStatus | null>(null)
  const [setup, setSetup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const status = useStore((st) => st.status)
  const go = useStore((st) => st.go)
  const refresh = () => void api.syncStatus().then(setS).catch(() => {})
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    const off = api.onSync(refresh)
    return () => {
      clearInterval(id)
      void off.then((f) => f())
    }
  }, [])
  const pick = async () => {
    const dir = await open({ directory: true, title: tr('A folder synced between your PCs') })
    if (typeof dir === 'string') setSetup(dir)
  }
  const now = async () => {
    setBusy(true)
    try {
      done(await api.syncNow())
    } catch (e) {
      useStore.getState().notify(String(e), { kind: 'error' })
    } finally {
      setBusy(false)
      refresh()
    }
  }
  if (!s) return null
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">{tr('Your playlists, songs, listening history, Live Editor versions and settings on all your PCs, without an account or a server.')}</p>
      <Card setting="OneDrive" title={s.folder && !s.onedrive.some((o) => s.folder!.toLowerCase().startsWith(o.toLowerCase())) ? tr('Shared folder') : 'OneDrive'} icon={<Cloud size={16} />}>
        {s.folder ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
              <span className="font-medium">{tr('Syncing through {folder}', { folder: s.folder })}</span>
              <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] text-ink-2">
                {s.protected ? <LockSimple size={11} /> : <LockSimpleOpen size={11} />} {s.protected ? tr('Password') : tr('No password')}
              </span>
            </p>
            {s.error ? <p className="text-xs text-[#F23F43]">{s.error}</p> : note(s.last ? tr('Last checked {when}. Changes go out within a minute.', { when: timeAgo(s.last) }) : tr('First sync…'))}
            <div className="flex gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => void now()}>
                <ArrowsClockwise size={14} className={busy ? 'animate-spin' : ''} /> {tr('Sync now')}
              </Button>
              {s.error && s.protected && (
                <Button variant="ghost" onClick={() => setSetup(s.folder)}>
                  {tr('Enter the password')}
                </Button>
              )}
              <Button variant="ghost" onClick={() => void api.syncStop().then(refresh)}>
                {tr('Stop syncing on this PC')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {s.onedrive.length ? note(tr('OneDrive is on this PC ({folder}). Each PC keeps its own file there; OneDrive carries them.', { folder: s.onedrive[0] })) : note(tr('OneDrive isn’t on this PC. Any folder your PCs share works the same way.'))}
            <div className="flex gap-2">
              {s.onedrive.length > 0 && <Button onClick={() => setSetup(s.onedrive[0])}>{tr('Sync through OneDrive…')}</Button>}
              <Button variant="ghost" onClick={() => void pick()}>
                <FolderOpen size={14} /> {tr('Another folder…')}
              </Button>
            </div>
          </>
        )}
      </Card>
      <Network onDone={refresh} />
      {s.devices.length > 0 && (
        <Card setting="Your other PCs" title={tr('Your other PCs')} icon={<Desktop size={16} />}>
          {s.devices.map((d) => {
            const missing = [d.accounts.spotify && !status.spotify.connected && 'Spotify', d.accounts.youtube && !status.youtube.connected && 'YouTube Music'].filter(Boolean)
            return (
              <div key={d.name + d.at} className="flex items-center gap-3 border-t border-line-soft pt-3 text-[0.8125rem] first-of-type:border-0 first-of-type:pt-0">
                <span className="flex-1">
                  <span className="font-medium">{d.name}</span> <span className="text-xs text-ink-2">· {tr('changed {when}', { when: timeAgo(d.at) })}</span>
                  {missing.length > 0 && <span className="block text-xs text-ink-2">{tr('Signed in there, not here: {services}', { services: missing.join(', ') })}</span>}
                </span>
                {missing.length > 0 && (
                  <Button variant="ghost" onClick={() => go({ name: 'settings', section: 'sources' })}>
                    {tr('Sign in here')}
                  </Button>
                )}
              </div>
            )
          })}
        </Card>
      )}
      {note(tr('When the same thing changed on two PCs, the most recent change wins. Deleted things stay deleted everywhere. Local files stay on each PC: their songs are matched by title, artist and length.'))}
      {note(tr('This PC: {name}. Its interface size and mini player spot stay its own.', { name: s.deviceName }))}
      {setup && (
        <Setup
          folder={setup}
          onClose={() => setSetup(null)}
          onDone={() => {
            setSetup(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

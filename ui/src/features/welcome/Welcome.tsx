import { ArrowRight, ArrowSquareOut, Key, MagnifyingGlass, MusicNotes, ShieldCheck, type Icon } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import { useSettings } from '../../app/settings'
import { useStore } from '../../app/store'
import { msg, tr, trn } from '../../shared/i18n/i18n'
import { PRIVACY_PAGE } from '../../shared/links'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { Logo } from '../../shared/ui/Logo'
import { WaysIn } from './WaysIn'

/** What the app does and keeps to itself, before it asks for anything (the same words as Settings › About and Accounts). */
const PROMISES: { icon: Icon; title: string; text: string }[] = [
  { icon: MusicNotes, title: msg('Every source, one queue'), text: msg('Local file first, then the official YouTube player, then the Apple Music preview.') },
  { icon: ShieldCheck, title: msg('Private by design'), text: msg('No server, no account of ours: your library, history and settings stay on this PC.') },
  { icon: Key, title: msg('Your sign-ins stay yours'), text: msg('You type your password on Google’s own page, never in Legato. The session stays in the app’s browser storage on this PC, like in a browser.') },
  { icon: MagnifyingGlass, title: msg('Nothing to set up'), text: msg('Search and play right away: signing in only brings your own playlists in.') },
]

/**
 * First launch (firstRun.ts shouldWelcome): what Legato is and keeps private, then the ways music comes in. Closed any
 * way (Escape, the backdrop, a card opening a page), it's seen: settings welcomed.
 */
export function Welcome({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'intro' | 'music'>('intro')
  const songs = useStore((s) => s.tracks.length)
  const done = () => {
    useSettings.getState().update({ welcomed: true })
    onClose()
  }
  // Each step's main button takes the focus (the one clicked is gone).
  useEffect(() => document.querySelector<HTMLElement>('[role=dialog] [data-default]')?.focus(), [step])
  return (
    <Dialog title={step === 'intro' ? tr('Welcome to Legato') : tr('Bring your music')} onClose={done} wide>
      {step === 'intro' ? (
        <div key="intro" className="swap-in flex flex-col gap-6">
          <div className="-mt-1 flex items-center gap-3.5">
            <span data-brand className="[&>svg]:size-11">
              <Logo />
            </span>
            <p className="text-[0.9375rem] text-ink-2">{tr('One library and one player for YouTube Music, Spotify, Apple Music and your own files.')}</p>
          </div>
          <ul className="stagger grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-x-6 gap-y-4">
            {PROMISES.map(({ icon: Glyph, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised">
                  <Glyph size={18} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{tr(title)}</span>
                  <span className="text-[0.8125rem] text-ink-2">{tr(text)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="link" onClick={() => void openUrl(PRIVACY_PAGE).catch(() => {})}>
              <ArrowSquareOut size={14} /> {tr('What leaves your PC')}
            </Button>
            <Button data-default onClick={() => setStep('music')}>
              {tr('Get started')} <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      ) : (
        <div key="music" className="swap-in flex flex-col gap-5">
          <p className="-mt-2 text-[0.8125rem] text-ink-2">{tr('Pick any, or none: Add music has them all, any time.')}</p>
          <WaysIn onLeave={done} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep('intro')}>
              {tr('Back')}
            </Button>
            <span className="flex items-center gap-3">
              {songs > 0 && <span className="text-xs text-ink-2 tabular-nums">{trn(songs, '{n} song in your library', '{n} songs in your library')}</span>}
              <Button data-default onClick={done}>
                {tr('Start listening')}
              </Button>
            </span>
          </div>
        </div>
      )}
    </Dialog>
  )
}

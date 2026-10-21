import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { ACTIONS, bindings, comboLabel, comboOf, conflicts, hasModifier, type ActionId, type Combo } from '../../app/keys'
import { useSettings } from '../../app/settings'
import { useGlobalShortcuts } from '../../app/shortcuts'
import { Button } from '../../shared/ui/Button'
import { RoundButton } from '../../shared/ui/controls'
import { tr } from '../../shared/i18n/i18n'

/**
 * One binding: click, then press the keys. Esc cancels, Backspace / Delete removes it. Global ones need a modifier (a
 * bare key held system-wide would stop typing it anywhere else).
 */
function KeyButton({ combo, onChange, global, problem, label }: { combo: Combo | null; onChange: (c: Combo | null) => void; global: boolean; problem?: string; label: string }) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')
  // Latest callback, without restarting the recording on every render.
  const change = useRef(onChange)
  change.current = onChange
  useEffect(() => {
    if (!recording) return
    // The app's own shortcuts stand aside while recording.
    document.body.dataset.recording = '1'
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
      if (plain && e.key === 'Escape') return setRecording(false)
      if (plain && (e.key === 'Backspace' || e.key === 'Delete')) {
        change.current(null)
        return setRecording(false)
      }
      const c = comboOf(e)
      if (!c) return
      if (global && !hasModifier(c)) return setHint(tr('Add Ctrl, Alt or Shift'))
      change.current(c)
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      delete document.body.dataset.recording
      window.removeEventListener('keydown', onKey, true)
      setHint('')
    }
  }, [recording, global])
  return (
    <span className="flex w-44 flex-col items-start gap-1">
      <button
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        aria-label={tr('{action}: {keys}. Change', { action: label, keys: combo ? comboLabel(combo) : tr('none') })}
        className={`min-w-24 rounded-md border px-2 py-0.5 text-left font-mono text-xs transition ${recording ? 'border-accent bg-accent-soft' : problem ? 'border-danger' : 'border-line bg-recess hover:border-ink-3'}`}
      >
        {recording ? tr('Press keys…') : combo ? comboLabel(combo) : '—'}
      </button>
      {(hint || problem) && <span className="text-[11px] text-danger">{hint || problem}</span>}
    </span>
  )
}

/** Settings › Shortcuts: every action, its keys in the app and everywhere (global), all editable. */
export function ShortcutsSection() {
  const custom = useSettings((s) => s.settings.shortcuts)
  const update = useSettings((s) => s.update)
  const failed = useGlobalShortcuts((s) => s.failed)
  const b = bindings(custom)
  const clash = conflicts(b)
  const set = (id: ActionId, kind: 'keys' | 'global', combo: Combo | null) => {
    const def = ACTIONS.find((a) => a.id === id)![kind]
    const next = { ...custom[id] }
    if (combo === def) delete next[kind]
    else next[kind] = combo
    update({ shortcuts: { ...custom, [id]: next } })
  }
  const problem = (id: ActionId, kind: 'keys' | 'global') => {
    if (clash.has(`${kind}:${id}`)) return tr('Also used by another action')
    if (kind === 'global' && failed.includes(id) && b[id].global) return tr('Taken by another app')
    return undefined
  }
  return (
    <div className="flex max-w-190 flex-col gap-4">
      <p className="text-[13px] text-ink-2">
        <span className="font-medium text-ink">{tr('In the app')}</span>
        {tr(': anywhere but while typing.')} <span className="font-medium text-ink">{tr('Everywhere')}</span>
        {tr(': with the app in the background or in the tray too. Click a key to change it, Backspace removes it. Media keys and the Windows media panel always work.')}
      </p>
      <div className="rounded-xl border border-line bg-raised">
        <div className="flex items-center gap-4 border-b border-line-soft px-4 py-2">
          <span className="kicker flex-1">{tr('Action')}</span>
          <span className="kicker w-44">{tr('In the app')}</span>
          <span className="kicker w-44">{tr('Everywhere')}</span>
          <span className="w-7" />
        </div>
        {ACTIONS.map((a) => {
          const changed = !!custom[a.id] && Object.keys(custom[a.id]!).length > 0
          return (
            <div key={a.id} data-setting={a.label} className="flex items-center gap-4 border-b border-line-soft px-4 py-2.5 last:border-0">
              <span className="flex-1 text-[13px] font-medium">{tr(a.label)}</span>
              {a.globalOnly ? <span className="w-44 text-xs text-ink-3">—</span> : <KeyButton label={tr(a.label)} combo={b[a.id].keys} onChange={(c) => set(a.id, 'keys', c)} global={false} problem={problem(a.id, 'keys')} />}
              <KeyButton label={tr('{action}, everywhere', { action: tr(a.label) })} combo={b[a.id].global} onChange={(c) => set(a.id, 'global', c)} global problem={problem(a.id, 'global')} />
              <span className="w-7">
                {changed && (
                  <RoundButton label={tr('Reset {action}', { action: tr(a.label) })} kind="plain" size="xs" onClick={() => update({ shortcuts: { ...custom, [a.id]: {} } })}>
                    <ArrowCounterClockwise size={13} />
                  </RoundButton>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <div>
        <Button variant="ghost" onClick={() => update({ shortcuts: {} })}>
          {tr('Reset all shortcuts')}
        </Button>
      </div>
    </div>
  )
}

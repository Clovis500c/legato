import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowRight, ArrowSquareOut, Check, Copy, Info, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { useStore } from '../../app/store'
import type { Credentials, Service } from '../../shared/api'
import { Button } from '../../shared/ui/Button'
import { SourceIcon, sourceLabel } from '../../shared/ui/SourceIcon'
import { guides } from './guides'

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex h-10.5 items-center gap-2.5 rounded-[9px] border border-line bg-raised pr-1.5 pl-3">
      <code className="flex-1 truncate font-mono text-[11px]">{value}</code>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] font-medium hover:bg-bg"
        onClick={() => navigator.clipboard.writeText(value).then(() => setDone(true))}
      >
        {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function ConnectWizard({ service, onClose }: { service: Service; onClose: () => void }) {
  const { connect, busy, error } = useStore()
  const guide = guides[service]
  const last = guide.steps.length - 1
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Credentials>({})
  const ready = guide.fields.every((f) => values[f.key]?.trim())

  return (
    <form
      className="flex w-120 shrink-0 flex-col gap-6 overflow-y-auto border-l border-line bg-panel px-8 py-10"
      onSubmit={async (e) => {
        e.preventDefault()
        if (step < last) return setStep(step + 1)
        if (await connect(service, values)) onClose()
      }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full border border-line">
            <SourceIcon source={service} size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">Connect {sourceLabel[service]}</h2>
            <p className="kicker">
              Step {step + 1} of {guide.steps.length}
            </p>
          </div>
        </div>
        <button type="button" aria-label="Close" className="text-ink-3 hover:text-ink" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="flex gap-1.5" aria-hidden>
        {guide.steps.map((_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-ink' : i === step ? 'bg-accent' : 'bg-line'}`} />
        ))}
      </div>

      <p className="flex gap-2.5 rounded-lg border border-line bg-recess px-3.5 py-3 text-xs leading-relaxed">
        <Info size={16} className="shrink-0 text-ink-2" /> {guide.callout}
      </p>

      <ol className="flex flex-col gap-5.5">
        {guide.steps.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'pending'
          return (
            <li key={s.title} className="flex gap-3.5" aria-current={state === 'current' ? 'step' : undefined}>
              <span
                className={`grid size-6.5 shrink-0 place-items-center rounded-full text-[13px] font-bold ${
                  state === 'done' ? 'bg-ink text-bg' : state === 'current' ? 'bg-accent text-on-accent' : 'border border-line text-ink-3'
                }`}
              >
                {state === 'done' ? <Check size={15} /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <h3 className={`text-sm font-semibold ${state === 'current' ? '' : 'text-ink-2'}`}>{s.title}</h3>
                {state === 'current' && (
                  <>
                    <p className="text-xs leading-relaxed text-ink-2">{s.text}</p>
                    {s.copy && <CopyField value={s.copy} />}
                    {s.link && (
                      <Button variant="link" className="w-fit text-xs" onClick={() => openUrl(s.link!.url)}>
                        {s.link.label} <ArrowSquareOut size={13} />
                      </Button>
                    )}
                    {i === last &&
                      guide.fields.map((f) => (
                        <label key={f.key} className="flex flex-col gap-1.5 text-xs text-ink-2">
                          {f.label}
                          <input
                            type={f.secret ? 'password' : 'text'}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={f.placeholder}
                            value={values[f.key] ?? ''}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                            className="h-10.5 rounded-lg border border-line bg-raised px-3 text-[13px] text-ink placeholder:text-ink-3"
                          />
                        </label>
                      ))}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {error && <p className="rounded-lg border border-line bg-recess px-3.5 py-3 text-xs text-danger">{error}</p>}

      <footer className="mt-auto flex items-center justify-between">
        <Button variant="ghost" className="border-0 text-ink-2" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </Button>
        {step < last ? (
          <Button type="submit">
            Done, continue <ArrowRight size={15} />
          </Button>
        ) : (
          <Button type="submit" disabled={!ready || busy}>
            {busy ? 'Waiting for the browser…' : 'Connect (opens the browser)'} <ArrowRight size={15} />
          </Button>
        )}
      </footer>
    </form>
  )
}

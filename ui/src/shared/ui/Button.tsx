import type { ButtonHTMLAttributes } from 'react'

const variants = {
  primary: 'bg-ink text-bg font-semibold hover:opacity-85',
  accent: 'bg-accent text-on-accent font-semibold hover:brightness-110',
  ghost: 'border border-line text-ink hover:bg-raised',
  link: 'text-ink font-semibold underline-offset-4 hover:underline px-0! py-0!',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }

/** Text pill, for actions that need words (Connect, Apply). Playback uses RoundButton. */
export function Button({ variant = 'primary', className = '', ...props }: Props) {
  return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[0.8125rem] transition disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${className}`} {...props} />
}

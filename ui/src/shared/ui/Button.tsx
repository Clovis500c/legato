import type { ButtonHTMLAttributes } from 'react'

const variants = {
  primary: 'bg-linear-to-r from-accent-from to-accent-to text-white font-semibold hover:brightness-110',
  ghost: 'border border-line text-fg hover:bg-surface',
  subtle: 'bg-surface border border-line text-muted hover:text-fg',
  link: 'text-accent hover:underline px-0! py-0!',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] transition disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Chip({ className = '', ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${className}`} {...props} />
}

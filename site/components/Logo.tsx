/** Legato's app icon (Figma, 01 Brand › AppIcon): the L on the playback blue. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" aria-hidden className={className}>
      <rect width="128" height="128" rx="32" fill="#7CB8FF" />
      <path d="M87.7969 84.3438V97H53.2969V84.3438H87.7969ZM59.1562 28.75V97H42.7031V28.75H59.1562Z" fill="#0F0F0F" />
    </svg>
  )
}

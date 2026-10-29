/** The app's "Level M" mark (src-tauri/icons/icon.svg). */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden className={className}>
      <rect width="256" height="256" rx="58" fill="#161614" />
      <g fill="none" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 -6)">
        <path d="M84 84 L128 152 L172 84" stroke="#FF6A2E" />
        <path d="M58 190 V100 Q58 70 84 84 M172 84 Q198 70 198 100 V190" stroke="#EDEAE4" />
      </g>
    </svg>
  )
}

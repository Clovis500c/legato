/** The app icon's M (src-tauri/icons/icon.svg): legs in the text color, the dip in the icon's orange (not the accent:
 *  a grey Windows accent turned it grey). */
export function Logo() {
  const line = { fill: 'none', strokeWidth: 30, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="40 54 176 148" className="size-5.5 shrink-0" aria-hidden>
      <path d="M84 78 L128 146 L172 78" stroke="#FF6A2E" {...line} />
      <path d="M58 184 V94 Q58 64 84 78 M172 78 Q198 64 198 94 V184" stroke="currentColor" {...line} />
    </svg>
  )
}

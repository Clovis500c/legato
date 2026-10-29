/**
 * CSS from outside the app (plugins, themes): comments, @import, links (url(), except data: images, and the app's
 * own image scheme when allowed), old script hooks and anything that could close the <style> taken out. Set as text,
 * never parsed as HTML. Pure.
 */
export function cleanCss(raw: unknown, max = 100_000): string {
  return (typeof raw === 'string' ? raw.slice(0, max) : '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(|-moz-binding|behavior\s*:/gi, '')
    .replace(/<\/?style/gi, '')
}

/**
 * Legato's name, logo and legal notices (marked `data-brand`) stay as they are, whatever a theme's or a plugin's
 * CSS says. Goes after their styles.
 */
export const BRAND_GUARD = `:root [data-brand][data-brand][data-brand], :root [data-brand][data-brand][data-brand] * { visibility: visible !important; opacity: 1 !important; filter: none !important; clip-path: none !important; transform: none !important; mask: none !important; }
:root [data-brand][data-brand][data-brand] { display: revert-layer !important; }
:root [data-brand][data-brand][data-brand]::before, :root [data-brand][data-brand][data-brand]::after, :root [data-brand][data-brand][data-brand] *::before, :root [data-brand][data-brand][data-brand] *::after { content: none !important; }
:root [data-brand-name][data-brand-name][data-brand-name] { font-size: 15px !important; letter-spacing: normal !important; color: var(--ink) !important; }`

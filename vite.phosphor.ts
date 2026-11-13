import type { Plugin } from 'vite'

/**
 * Phosphor's icons each carry six weights; the app draws regular (the default), bold and fill. The release build drops the other
 * three from every icon (thin, light, duotone: about a third of the first screen's JS, 2026-11-13). An icon asked in a weight it
 * no longer has draws nothing: a new weight goes in `KEEP` (and the test in `ui/src/app/phosphorWeights.test.ts` says which).
 */
export const KEEP = ['regular', 'bold', 'fill']
export const trimWeights = (code: string): string => code.replace(/\n {2}\[\n {4}"(\w+)",[\s\S]*?\n {2}\],?(?=\n(?: {2}\[|\]\)))/g, (entry, weight: string) => (KEEP.includes(weight) ? entry : ''))

export const phosphor = (): Plugin => ({
  name: 'phosphor-weights',
  apply: 'build',
  transform(code, id) {
    return /@phosphor-icons[\/]react[\/]dist[\/]defs[\/][^\/]+\.es\.js$/.test(id) ? { code: trimWeights(code), map: null } : null
  },
})

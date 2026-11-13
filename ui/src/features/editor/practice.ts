import type { Effects } from "../../shared/api";

/** The player menu's practice speeds (the Live Editor's tempo, pitch kept). */
export const PRACTICE = [0.5, 0.75, 0.9, 1] as const;

/** The speed heard now: the editor's tempo while its effects are on, else normal. */
export const practiceNow = (e: Pick<Effects, "on" | "tempo">) =>
  e.on ? e.tempo : 1;

/**
 * The editor change for speed `x`, or null when it is the speed heard already (no draft for nothing). Normal speed only
 * puts the tempo back: effects the user had bypassed stay bypassed.
 */
export function practicePatch(
  e: Pick<Effects, "on" | "tempo">,
  x: number,
): Partial<Effects> | null {
  if (Math.abs(practiceNow(e) - x) < 0.005) return null;
  return x === 1 ? { tempo: 1 } : { tempo: x, on: true };
}

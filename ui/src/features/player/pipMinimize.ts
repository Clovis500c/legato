/**
 * One change of the window's minimized state (Settings › General › Picture-in-picture on minimize). Pure: `pipMode.ts`
 * reads the window and the stores. `wanted`: the setting on, a song playing; `pip`: picture in picture open,
 * `fromMinimize` when a minimize opened it; `hidden`: that one minimized in turn.
 */
export function minimizeStep(s: { was: boolean; now: boolean; pip: boolean; fromMinimize: boolean; hidden: boolean; wanted: boolean }): { hidden: boolean; act: 'open' | 'close' | null } {
  if (s.now === s.was) return { hidden: s.hidden, act: null }
  // Minimized: the full window opens picture in picture instead; picture in picture itself just goes down.
  if (s.now) return s.pip ? { hidden: s.fromMinimize, act: null } : { hidden: s.hidden, act: s.wanted ? 'open' : null }
  // Restored: the full window again when it was the minimize's picture in picture.
  return { hidden: false, act: s.hidden ? 'close' : null }
}

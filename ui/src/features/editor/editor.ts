import { create } from 'zustand'
import { api, type Edit, type Effects } from '../../shared/api'
import { cleanEffects, NEUTRAL, songKey } from '../player/effects'
import { usePlayer } from '../player/store'

/**
 * Live Editor state: the settings playing now (applied live by liveSync), the song's saved versions (one may be
 * active: it plays whenever the song does) and the saved presets. Only numbers are stored (SQLite `edits`).
 */
interface EditorState {
  song: string | null
  effects: Effects
  versions: Edit[]
  presets: Edit[]
  /** Version the settings came from (null = the song as is, or built from a preset). */
  versionId: number | null
  /** Changed since loaded or saved. */
  dirty: boolean
}

export const useEditor = create<EditorState>(() => ({ song: null, effects: NEUTRAL, versions: [], presets: [], versionId: null, dirty: false }))

const parse = (e: Edit) => cleanEffects(safeJson(e.effects))
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * A song starts: its unsaved settings if the app closed on them (user's request 2026-10-22), else its active version,
 * else the song as is.
 */
export async function loadSong(song: string | null) {
  flushDraft()
  useEditor.setState({ song })
  const [versions, presets, draft] = await Promise.all([
    song ? api.edits(song).catch(() => []) : Promise.resolve([]),
    api.edits(null).catch(() => []),
    song ? api.editDraft(song).catch(() => null) : Promise.resolve(null),
  ])
  // Another song came meanwhile.
  if (useEditor.getState().song !== song) return
  const active = versions.find((v) => v.active)
  if (draft) {
    const from = versions.some((v) => v.id === draft.version) ? draft.version : null
    return useEditor.setState({ versions, presets, versionId: from, effects: cleanEffects(draft.effects), dirty: true })
  }
  useEditor.setState({ versions, presets, versionId: active?.id ?? null, effects: active ? parse(active) : NEUTRAL, dirty: false })
}

// Unsaved settings go to the library a moment after the last change (and right away when the song changes or the
// window closes): a crash loses a quarter of a second at most.
let draftTimer: ReturnType<typeof setTimeout> | undefined
let draftFor: string | null = null
function flushDraft() {
  if (draftTimer === undefined) return
  clearTimeout(draftTimer)
  draftTimer = undefined
  const s = useEditor.getState()
  if (draftFor && draftFor === s.song) void api.saveEditDraft(draftFor, s.dirty ? { effects: s.effects, version: s.versionId } : null).catch(() => {})
}
function keepDraft() {
  draftFor = useEditor.getState().song
  clearTimeout(draftTimer)
  draftTimer = setTimeout(flushDraft, 250)
}
/** Saved, or back to a saved state: no draft left. */
function dropDraft() {
  clearTimeout(draftTimer)
  draftTimer = undefined
  const { song } = useEditor.getState()
  if (song) void api.saveEditDraft(song, null).catch(() => {})
}

export function setEffects(patch: Partial<Effects>) {
  useEditor.setState((s) => ({ effects: { ...s.effects, ...patch }, dirty: true }))
  keepDraft()
}

/** On / off without losing the settings: hear the song as is, then back (A / B). */
export const bypass = (on: boolean) => useEditor.setState((s) => ({ effects: { ...s.effects, on } }))

export function reset() {
  useEditor.setState({ effects: NEUTRAL, versionId: null, dirty: true })
  keepDraft()
}

/** Settings from a built-in or saved preset, to tune and save as a version. */
export function applyPreset(effects: Effects) {
  useEditor.setState({ effects: { ...effects, on: true }, versionId: null, dirty: true })
  keepDraft()
}

async function refresh() {
  const { song } = useEditor.getState()
  const [versions, presets] = await Promise.all([song ? api.edits(song) : Promise.resolve([]), api.edits(null)])
  useEditor.setState({ versions, presets })
}

/** Saves the settings as a new version of this song, now the one that plays with it. */
export async function saveVersion(name: string) {
  const { song, effects } = useEditor.getState()
  if (!song) return
  const id = await api.saveEdit(null, song, name, effects)
  await api.activateEdit(song, id)
  useEditor.setState({ versionId: id, dirty: false })
  dropDraft()
  await refresh()
}

/** Overwrites the version the settings came from. */
export async function updateVersion() {
  const { song, effects, versionId, versions } = useEditor.getState()
  const v = versions.find((x) => x.id === versionId)
  if (!song || !v) return
  await api.saveEdit(v.id, song, v.name, effects)
  useEditor.setState({ dirty: false })
  dropDraft()
  await refresh()
}

/** Plays this version with the song (null = the song as is). */
export async function playVersion(id: number | null) {
  const { song, versions } = useEditor.getState()
  if (!song) return
  await api.activateEdit(song, id)
  const v = versions.find((x) => x.id === id)
  useEditor.setState({ versionId: id, effects: v ? parse(v) : NEUTRAL, dirty: false })
  dropDraft()
  await refresh()
}

export async function renameVersion(id: number, name: string) {
  const { song, versions } = useEditor.getState()
  const v = versions.find((x) => x.id === id)
  if (!song || !v) return
  await api.saveEdit(id, song, name, cleanEffects(safeJson(v.effects)))
  await refresh()
}

export async function deleteVersion(id: number) {
  await api.deleteEdit(id)
  if (useEditor.getState().versionId === id) useEditor.setState({ versionId: null, effects: NEUTRAL })
  await refresh()
}

export async function savePreset(name: string) {
  await api.saveEdit(null, null, name, useEditor.getState().effects)
  await refresh()
}

export async function deletePreset(id: number) {
  await api.deleteEdit(id)
  await refresh()
}

export const presetEffects = parse

/** Follows the playing song (call once; returns cleanup). */
export function startEditor(): () => void {
  const key = () => songKey(usePlayer.getState().now)
  let last: string | null | undefined
  const check = () => {
    const k = key()
    if (k === last) return
    last = k
    void loadSong(k)
  }
  check()
  const off = usePlayer.subscribe(check)
  // Closing (or an update's restart): the last change goes in now.
  window.addEventListener('beforeunload', flushDraft)
  return () => {
    off()
    window.removeEventListener('beforeunload', flushDraft)
  }
}

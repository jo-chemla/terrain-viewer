import { useEffect, useRef } from "react"
import { pushToast } from "@/components/ui/toast"

// App-wide undo and redo over the URL state (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
// or Ctrl/Cmd+Y). Every shareable setting already lives in one nuqs object
// (QUERY_STATE_PARSERS in TerrainViewer.tsx), so a history of that object
// covers viz modes, ramps, sources, split layout, the timeline date, the
// detector thresholds - anything a control writes - without each control
// knowing about undo.
//
// The camera (lat, lng, zoom, pitch, bearing) is a step only after a pause:
// a move that starts more than CAMERA_PAUSE_MS after the previous one records
// where the camera stood, so Ctrl+Z after flying off somewhere brings you
// back, while a run of pans stays one step instead of burying every setting
// change under dozens. Undoing a camera step moves the camera and nothing
// else; undoing a setting step leaves the camera where it is.
//
// Not in the history: Terra Draw's features (its own store, not the URL),
// and text fields - while an input, textarea or editable element has focus
// the keys go to the browser's own text undo.
//
// Coalescing: a slider emits a change every few milliseconds, so setting
// changes within COALESCE_MS of each other extend the same step.

const CAMERA_KEYS = ["lat", "lng", "zoom", "pitch", "bearing"] as const
const CAMERA_KEY_SET = new Set<string>(CAMERA_KEYS)
const COALESCE_MS = 700
const CAMERA_PAUSE_MS = 60_000
const MAX_STEPS = 100

type Snapshot = Record<string, unknown>
type Step = { snap: Snapshot; camera: boolean }
export type CameraPose = Partial<Record<(typeof CAMERA_KEYS)[number], number>>

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Keys whose value differs between two snapshots, with `to`'s values. */
function diff(from: Snapshot, to: Snapshot, keep: (k: string) => boolean): Snapshot {
  const out: Snapshot = {}
  for (const k of Object.keys(to)) if (keep(k) && !same(from[k], to[k])) out[k] = to[k]
  for (const k of Object.keys(from)) if (keep(k) && !(k in to)) out[k] = null
  return out
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}

const humanize = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
const isCamera = (k: string) => CAMERA_KEY_SET.has(k)
const isSetting = (k: string) => !CAMERA_KEY_SET.has(k)

export function useUrlStateHistory(
  state: Record<string, unknown>,
  setState: (updates: Record<string, unknown>) => unknown,
  /** Moves the live map: the URL camera only seeds the map at mount, so
   *  writing lat/lng back to the URL alone would not move anything. */
  moveCamera?: (pose: CameraPose) => void,
) {
  const past = useRef<Step[]>([])
  const future = useRef<Step[]>([])
  const last = useRef<Snapshot | null>(null)
  const lastSettingChangeAt = useRef(0)
  const lastCameraChangeAt = useRef(Date.now())
  // Set while a change we issued ourselves (undo/redo) is landing, so it is
  // recorded as the new present without becoming a fresh undo step.
  const applyingUntil = useRef(0)
  const setStateRef = useRef(setState)
  setStateRef.current = setState
  const moveCameraRef = useRef(moveCamera)
  moveCameraRef.current = moveCamera

  useEffect(() => {
    const snap = { ...state }
    if (last.current === null) { last.current = snap; return }
    const settingChanges = diff(last.current, snap, isSetting)
    const cameraChanges = diff(last.current, snap, isCamera)
    const hasSetting = Object.keys(settingChanges).length > 0
    const hasCamera = Object.keys(cameraChanges).length > 0
    if (!hasSetting && !hasCamera) return
    const now = Date.now()
    if (now < applyingUntil.current) {
      last.current = snap
      if (hasCamera) lastCameraChangeAt.current = now
      return
    }
    const record = (camera: boolean) => {
      past.current.push({ snap: last.current!, camera })
      if (past.current.length > MAX_STEPS) past.current.shift()
      future.current = []
    }
    if (hasSetting) {
      if (now - lastSettingChangeAt.current > COALESCE_MS) record(false)
      lastSettingChangeAt.current = now
    }
    if (hasCamera) {
      if (now - lastCameraChangeAt.current > CAMERA_PAUSE_MS) record(true)
      lastCameraChangeAt.current = now
    }
    last.current = snap
  }, [state])

  useEffect(() => {
    const step = (direction: "undo" | "redo"): boolean => {
      const from = direction === "undo" ? past.current : future.current
      const to = direction === "undo" ? future.current : past.current
      const target = from.pop()
      if (!target || !last.current) return false
      const updates = diff(last.current, target.snap, target.camera ? isCamera : isSetting)
      if (Object.keys(updates).length === 0) return step(direction)
      to.push({ snap: last.current, camera: target.camera })
      // Covers the camera's moveend write as well as the setState itself.
      applyingUntil.current = Date.now() + (target.camera ? 1500 : 300)
      lastSettingChangeAt.current = 0
      setStateRef.current(updates)
      if (target.camera) moveCameraRef.current?.(updates as CameraPose)
      const keys = Object.keys(updates)
      pushToast({
        key: "url-history",
        title: direction === "undo" ? "Undone" : "Redone",
        body: target.camera
          ? "camera"
          : keys.length <= 3 ? keys.map(humanize).join(", ") : `${keys.slice(0, 2).map(humanize).join(", ")} and ${keys.length - 2} more`,
        duration: 2500,
      })
      return true
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== "z" && key !== "y") return
      if (isTextTarget(e.target)) return
      const redo = key === "y" || (key === "z" && e.shiftKey)
      e.preventDefault()
      const done = step(redo ? "redo" : "undo")
      if (!done) pushToast({ key: "url-history", title: redo ? "Nothing to redo" : "Nothing to undo", duration: 1500 })
    }
    // Capture phase so the map canvas (or any other focused element) can't
    // swallow the event first — same reasoning as use-geocoder-shortcut.ts.
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [])
}

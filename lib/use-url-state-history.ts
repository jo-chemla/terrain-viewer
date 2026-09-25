import { useEffect, useRef } from "react"
import { pushToast } from "@/components/ui/toast"

// App-wide undo and redo over the URL state (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
// or Ctrl/Cmd+Y). Every shareable setting already lives in one nuqs object
// (QUERY_STATE_PARSERS in TerrainViewer.tsx), so a history of that object
// covers viz modes, ramps, sources, split layout, the timeline date, the
// detector thresholds - anything a control writes - without each control
// knowing about undo.
//
// What is deliberately NOT in the history:
// - The camera (lat, lng, zoom, pitch, bearing). A pan writes it on every
//   move end, so it would bury every real change under dozens of pans, and
//   the browser's Back already walks the camera in 'push' history mode.
// - Terra Draw's features: they live in its own store, not in the URL.
// - Text fields: while an input, textarea or editable element has focus the
//   keys are left to the browser's own text undo.
//
// Coalescing: a slider emits a change every few milliseconds, so changes
// arriving within COALESCE_MS of each other extend the same undo step; the
// undo point is the state before the first of them.

const CAMERA_KEYS = new Set(["lat", "lng", "zoom", "pitch", "bearing"])
const COALESCE_MS = 700
const MAX_STEPS = 100

type Snapshot = Record<string, unknown>

function snapshotOf(state: Record<string, unknown>): Snapshot {
  const out: Snapshot = {}
  for (const k of Object.keys(state)) if (!CAMERA_KEYS.has(k)) out[k] = state[k]
  return out
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Keys whose value differs between two snapshots, with `to`'s values. */
function diff(from: Snapshot, to: Snapshot): Snapshot {
  const out: Snapshot = {}
  for (const k of Object.keys(to)) if (!same(from[k], to[k])) out[k] = to[k]
  for (const k of Object.keys(from)) if (!(k in to)) out[k] = null
  return out
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}

const humanize = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()

export function useUrlStateHistory(state: Record<string, unknown>, setState: (updates: Record<string, unknown>) => unknown) {
  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const last = useRef<Snapshot | null>(null)
  const lastChangeAt = useRef(0)
  // Set while a change we issued ourselves (undo/redo) is landing, so it is
  // recorded as the new present without becoming a fresh undo step.
  const applying = useRef(false)
  const setStateRef = useRef(setState)
  setStateRef.current = setState

  useEffect(() => {
    const snap = snapshotOf(state)
    if (last.current === null) { last.current = snap; return }
    const changed = diff(last.current, snap)
    if (Object.keys(changed).length === 0) return
    if (applying.current) {
      applying.current = false
      last.current = snap
      return
    }
    const now = Date.now()
    if (now - lastChangeAt.current > COALESCE_MS) {
      past.current.push(last.current)
      if (past.current.length > MAX_STEPS) past.current.shift()
      future.current = []
    }
    lastChangeAt.current = now
    last.current = snap
  }, [state])

  useEffect(() => {
    const step = (direction: "undo" | "redo") => {
      const from = direction === "undo" ? past.current : future.current
      const to = direction === "undo" ? future.current : past.current
      const target = from.pop()
      if (!target || !last.current) return false
      const updates = diff(last.current, target)
      if (Object.keys(updates).length === 0) return step(direction)
      to.push(last.current)
      applying.current = true
      // Coalescing must not fold the next user change into this step.
      lastChangeAt.current = 0
      setStateRef.current(updates)
      const keys = Object.keys(updates)
      pushToast({
        key: "url-history",
        title: direction === "undo" ? "Undone" : "Redone",
        body: keys.length <= 3 ? keys.map(humanize).join(", ") : `${keys.slice(0, 2).map(humanize).join(", ")} and ${keys.length - 2} more`,
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

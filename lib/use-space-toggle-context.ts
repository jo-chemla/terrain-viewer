import { useEffect } from "react"

// Keeps "press Space to re-toggle the control I last clicked" working after a
// map drag. The maplibre canvas is focusable (tabindex=0, for its arrow-key/
// +/- keyboard navigation), so the browser moves focus to it on mousedown —
// which is why Space keeps toggling after wheel-zooming (wheel never moves
// focus) but goes dead after dragging. Rather than preventDefault-ing the
// canvas's mousedown (which would kill maplibre's keyboard navigation
// entirely), remember the last toggle-shaped control the user clicked; when
// Space arrives while focus sits somewhere inert (body or the map canvas),
// hand focus back to that control and activate it. Subsequent presses are then
// handled natively by the refocused control until the map steals focus again.
//
// Deliberately restricted to role="checkbox"/"switch" targets: those are the
// only controls where re-triggering on a stale click context is always safe
// and idempotent-ish (on/off/on...). Remembering generic buttons would make a
// later Space re-fire actions like GeoJSON export or style cycling from a
// control the user may have clicked minutes ago.
export function useSpaceToggleContext() {
  useEffect(() => {
    let lastToggle: HTMLElement | null = null

    // Record on 'click', not 'pointerdown': clicking a <label htmlFor> fires
    // pointerdown on the label, and the checkbox only receives the browser's
    // synthesized activation click — so a pointerdown listener misses every
    // label-text click (which is how sub-mode toggles like Slope and More's
    // "Local Relief Model" are usually hit; the checkbox square itself is tiny).
    // The synthesized click is retargeted to the control, so this catches both
    // paths. Our own lastToggle.click() below re-triggers this listener with the
    // same element — harmless.
    const onClick = (e: MouseEvent) => {
      const toggle = (e.target as HTMLElement | null)?.closest?.('[role="checkbox"], [role="switch"]')
      if (toggle instanceof HTMLElement) lastToggle = toggle
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " ") return
      const active = document.activeElement
      const focusIsInert =
        !active || active === document.body || active === document.documentElement ||
        active.classList.contains("maplibregl-canvas")
      if (!focusIsInert || !lastToggle || !lastToggle.isConnected || (lastToggle as HTMLButtonElement).disabled) return
      e.preventDefault() // don't also scroll the page / feed Space to the map
      lastToggle.focus()
      lastToggle.click()
    }

    // Capture phase so the map canvas can't swallow the events first.
    document.addEventListener("click", onClick, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [])
}

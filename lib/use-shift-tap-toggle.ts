import { useEffect, useRef } from "react"

// Fires `onTap` when the user presses and releases Shift (either side — 'e.key'
// is "Shift" regardless of location) *by itself*, without it being held down as
// a modifier for something else (Shift+click, text selection, etc). Modeled
// after the same "was this key alone, not a modifier" pattern editors use for
// Alt-alone-toggles-menu-bar style bindings.
//
// Alt was tried first but conflicts with the browser's own Alt-alone behavior
// (highlights/focuses the menu bar on Windows) and can't be "un-pressed"
// without an Escape first — Shift has no such native single-key meaning.
//
// Tracking: on keydown of Shift, arm a flag; any OTHER key pressed while
// Shift is held disarms it (Shift was used as a modifier this time); on keyup
// of Shift, fire only if still armed. A window-blur listener resets the
// tracking state so alt-tabbing away mid-hold can't leave a stale armed flag
// that fires spuriously on refocus.
export function useShiftTapToggle(onTap: () => void) {
  const onTapRef = useRef(onTap)
  onTapRef.current = onTap

  useEffect(() => {
    let armed = false

    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        if (!e.repeat) armed = !isEditableTarget(e.target)
        return
      }
      // Any other key while Shift is down means Shift is being used as a
      // modifier (or the browser just reports shiftKey=true coincidentally) —
      // either way, releasing Shift afterward shouldn't toggle anything.
      if (e.shiftKey) armed = false
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return
      if (armed) onTapRef.current()
      armed = false
    }

    const onBlur = () => { armed = false }

    // Capture phase so the map canvas (or any other focused element) can't
    // swallow the events first — same reasoning as useSpaceToggleContext.
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [])
}

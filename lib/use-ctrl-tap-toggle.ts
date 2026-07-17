import { useEffect, useRef } from "react"

// Fires `onTap` when the user presses and releases Ctrl (either side) *by
// itself*, without it being held down as a modifier for something else
// (Ctrl+C, Ctrl+drag-to-rotate-the-map, etc). Same "was this key alone, not a
// modifier" pattern as lib/use-shift-tap-toggle.ts.
//
// Unlike Shift, Ctrl is also maplibre's own default drag-to-rotate/pitch
// modifier (dragRotate) and the browser's own page-zoom modifier (Ctrl+wheel)
// — both involve no other KEYDOWN, so use-shift-tap-toggle.ts's "any other
// key disarms it" check alone wouldn't catch them. A pointerdown or wheel
// event while Ctrl is held disarms here too, so rotating the map with
// Ctrl+drag or zooming with Ctrl+scroll and releasing Ctrl afterward doesn't
// also fire the tap callback. (This project tried Ctrl for a different
// tap-toggle before and moved off it onto Shift — these two disarm paths are
// the likely reason; kept as its own hook, not a use-shift-tap-toggle option,
// in case Ctrl turns out to need still more special-casing later.)
export function useCtrlTapToggle(onTap: () => void) {
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
      if (e.key === "Control") {
        if (!e.repeat) armed = !isEditableTarget(e.target)
        return
      }
      if (e.ctrlKey) armed = false
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Control") return
      if (armed) onTapRef.current()
      armed = false
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.ctrlKey) armed = false
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) armed = false
    }

    const onBlur = () => { armed = false }

    // Capture phase so the map canvas (or any other focused element) can't
    // swallow the events first — same reasoning as useSpaceToggleContext.
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("keyup", onKeyUp, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("wheel", onWheel, true)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("keyup", onKeyUp, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("wheel", onWheel, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [])
}

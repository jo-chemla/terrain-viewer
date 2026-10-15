import { useEffect } from "react"

// B toggles the Blend Mode effect of the Overlay split (the Blend Mode switch
// in Compare and Blend), so a Difference or Multiply blend can be flipped on
// and off while looking at the map, without reaching for the sidebar. The
// picked mode is untouched, as with the switch. Plain B only: no modifier,
// and never while typing in an input, a textarea or an editable element.
// Ignored when the split is not Overlay, where the blend has nothing to apply
// to. Capture phase so the map canvas cannot swallow the key first (the same
// reasoning as use-ctrl-tap-toggle.ts).
export function useBlendToggleShortcut(enabled: boolean, toggle: () => void) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return
      e.preventDefault()
      toggle()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [enabled, toggle])
}

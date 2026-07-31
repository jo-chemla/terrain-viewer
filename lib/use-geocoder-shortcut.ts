import { useEffect } from "react"

// Ctrl/Cmd+K focuses the geocoder search box (GeocoderControl.tsx), matching the
// "K opens search" convention used by GitHub/Slack/Linear/VSCode. Chosen over
// Ctrl+L (browsers reserve it for the address bar — keydown can't be
// preventDefault'd, so a page-level binding would silently never fire).
//
// Ctrl/Cmd+G was ORIGINALLY left out for the same reason (no established
// "search" meaning; Firefox in particular binds it to its own in-page
// "find next"), but is now wired in alongside K per explicit request —
// preventDefault in the capture phase below does successfully override it.
// Both keys do the exact same thing; K remains the primary documented one.
//
// Global document listener rather than something scoped to the geocoder
// itself: the whole point is to work from anywhere (map focused, sidebar
// focused, even another input focused), like every other app's command-K.
export function useGeocoderShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key !== "k" && key !== "g") return
      const input = document.querySelector<HTMLInputElement>(".maplibregl-ctrl-geocoder--input")
      if (!input) return
      e.preventDefault()
      // Focusing it is also what expands the collapsed search (see
      // GeocoderControl.tsx's own "focus" listener) — nothing extra needed here.
      input.focus()
      input.select()
    }

    // Capture phase so the map canvas (or any other focused element) can't
    // swallow the event first — same reasoning as use-ctrl-tap-toggle.ts.
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [])
}

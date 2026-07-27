import { useEffect } from "react"

// Ctrl/Cmd+K focuses the geocoder search box (GeocoderControl.tsx), matching the
// "K opens search" convention used by GitHub/Slack/Linear/VSCode. Chosen over
// Ctrl+L (browsers reserve it for the address bar — keydown can't be
// preventDefault'd, so a page-level binding would silently never fire) and
// Ctrl+G (no established "search" meaning; some browsers use it for
// find-next inside their own in-page find bar).
//
// Global document listener rather than something scoped to the geocoder
// itself: the whole point is to work from anywhere (map focused, sidebar
// focused, even another input focused), like every other app's command-K.
export function useGeocoderShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return
      const input = document.querySelector<HTMLInputElement>(".maplibregl-ctrl-geocoder--input")
      if (!input) return
      e.preventDefault()
      input.focus()
      input.select()
    }

    // Capture phase so the map canvas (or any other focused element) can't
    // swallow the event first — same reasoning as use-ctrl-tap-toggle.ts.
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [])
}

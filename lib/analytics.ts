// Thin wrapper over umami's custom-event API (the tracker script is loaded in
// index.html). Feature-usage events are discrete, intentional actions —
// enabling a viz mode, running an export, loading a BYOD source — NOT render
// churn, so they give a clean signal of what people actually use, unlike the
// nuqs-driven pageview stream.
//
// Safe to call anywhere: if umami isn't loaded (blocked, offline, dev) it's a
// no-op. Event names are kept short + stable so they group nicely in the umami
// dashboard; put anything variable in the data object. Umami's dashboard only
// sorts event names alphabetically, so names are prefix-grouped on purpose:
// actions-*, app-*, error-*, historical-*, options-*, source-*, tools-*, viz-*.

type UmamiTrack = (event: string, data?: Record<string, unknown>) => void

function getUmami(): { track?: UmamiTrack } | undefined {
  return (window as unknown as { umami?: { track?: UmamiTrack } }).umami
}

// The tracker script is injected with `defer` (and only outside local dev),
// so events fired during mount — app-mode/app-project resolution, the embed
// bridge handshake in main.tsx — happen before window.umami exists and would
// silently vanish. Queue them and flush once the tracker shows up; give up
// after ~20s (blocked, offline, or dev where the script is never injected).
const pending: Array<[string, Record<string, unknown> | undefined]> = []
let flushTimer: number | null = null
let waitedMs = 0

export function track(event: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return
  try {
    const umami = getUmami()
    if (umami?.track) {
      umami.track(event, data)
      return
    }
    pending.push([event, data])
    if (flushTimer !== null) return
    flushTimer = window.setInterval(() => {
      waitedMs += 1000
      const u = getUmami()
      if (u?.track) {
        for (const [e, d] of pending.splice(0)) {
          try { u.track(e, d) } catch { /* swallow, see below */ }
        }
      }
      if ((u?.track || waitedMs >= 20_000) && flushTimer !== null) {
        window.clearInterval(flushTimer)
        flushTimer = null
      }
    }, 1000)
  } catch {
    // Analytics must never break the app — swallow.
  }
}

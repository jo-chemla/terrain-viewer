// Thin wrapper over umami's custom-event API (the tracker script is loaded in
// index.html). Feature-usage events are discrete, intentional actions —
// enabling a viz mode, running an export, loading a BYOD source — NOT render
// churn, so they give a clean signal of what people actually use, unlike the
// nuqs-driven pageview stream.
//
// Safe to call anywhere: if umami isn't loaded (blocked, offline, dev) it's a
// no-op. Event names are kept short + stable so they group nicely in the umami
// dashboard; put anything variable in the data object.

type UmamiTrack = (event: string, data?: Record<string, unknown>) => void

export function track(event: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return
  const umami = (window as unknown as { umami?: { track?: UmamiTrack } }).umami
  try {
    umami?.track?.(event, data)
  } catch {
    // Analytics must never break the app — swallow.
  }
}

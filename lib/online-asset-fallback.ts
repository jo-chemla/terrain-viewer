// Pictures the app takes from the docs site (/docs/screenshots/...: the
// changelog's figures, the Data layers picker's thumbnails) are not in the
// light desktop build, which ships no docs folder (desktop/gen-config.mjs
// keeps only the thumbnails). Under views:// (Electrobun) a missing picture
// is a quick local failure: the <img> then retries once from the website.
// On the web nothing changes: the same origin served the picture or not.
export const ONLINE_SITE = "https://terrain-viewer.iconem.com"

const isDesktop = () => typeof location !== "undefined" && !/^https?:$/.test(location.protocol)

/** `onError` for an <img> whose src is a docs-site picture. */
export function fallbackToOnline(e: React.SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget
  if (!isDesktop() || img.dataset.onlineRetry) return
  img.dataset.onlineRetry = "1"
  try {
    const path = new URL(img.src, location.href).pathname.replace(/^\/app\//, "/")
    img.src = ONLINE_SITE + path
  } catch { /* leave the broken picture */ }
}

/** The same for pictures rendered from HTML (the changelog): one listener
 *  on the container, since React only hears errors on its own elements. */
export function attachOnlineFallback(container: HTMLElement | null): () => void {
  if (!container || !isDesktop()) return () => {}
  const onError = (ev: Event) => {
    const img = ev.target as HTMLImageElement
    if (!(img instanceof HTMLImageElement) || img.dataset.onlineRetry) return
    img.dataset.onlineRetry = "1"
    try { img.src = ONLINE_SITE + new URL(img.src, location.href).pathname.replace(/^\/app\//, "/") } catch { /* leave it */ }
  }
  container.addEventListener("error", onError, true)
  return () => container.removeEventListener("error", onError, true)
}

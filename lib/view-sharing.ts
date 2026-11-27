// Saved views behind short links: the one door the app goes through.
//
//   signIn(handle)            leaves for the account's authorization server
//   signOut()
//   session()                 who is signed in, from local storage (no network)
//   saveView(search, opts)    one record in the account's repository → a ref
//   loadView(ref)             anyone, no account: the record a ref points at
//
// Today the provider is the AT Protocol (lib/atproto-view.ts for the format
// and the public read, lib/atproto-oauth.ts for signing in and writing, the
// latter loaded on demand). Another provider would be another pair of files
// behind these same five functions.
import { buildViewRecord, loadView as loadAtprotoView, oauthClientConfig, viewLink, type LoadedView, type ViewRef } from "./atproto-view"

export { parseViewRef, formatViewRef, viewLink, expandedViewUrl, maskedParamKeys, ViewLoadError, VIEW_PARAM } from "./atproto-view"
export type { ViewRef, LoadedView } from "./atproto-view"

export interface ViewSession { did: string; handle: string | null }

const ACCOUNT_KEY = "tv-atproto-account"
/** Set once a sign-in completes, read once by the Share button as it
 *  mounts: the dialog opens itself where the user left. */
export const REOPEN_SHARE_KEY = "tv-atproto-reopen-share"

// Where the user was when the sign-in started: restored on the way back
// whether the sign-in succeeded, was refused or was cancelled (the library
// only hands its own state back on success). In localStorage with a time
// rather than sessionStorage, so a way back that lands in another tab, or
// in a tab the authorization page isolated, still finds it.
const RETURN_TO_KEY = "tv-atproto-return-to"
const RETURN_TO_MAX_AGE_MS = 30 * 60_000

const oauth = () => import("./atproto-oauth")

/** Null when this copy of the app can sign in; otherwise why not. */
export function signInUnavailableReason(): string | null {
  const c = oauthClientConfig(window.location)
  return c.ok ? null : c.reason
}

/** Who is signed in, as remembered by this browser. The tokens themselves
 *  are checked when a view is saved. */
export function session(): ViewSession | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v.did === "string" ? { did: v.did, handle: typeof v.handle === "string" ? v.handle : null } : null
  } catch { return null }
}

function remember(s: ViewSession | null): void {
  try { if (s) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(s)); else localStorage.removeItem(ACCOUNT_KEY) } catch { /* storage blocked */ }
}

/** Leaves the page for the authorization server of `handle`'s account. The
 *  current address is kept and restored on the way back. */
export async function signIn(handle: string): Promise<void> {
  const { startSignIn } = await oauth()
  const returnTo = `${window.location.pathname}${window.location.search}`
  try { localStorage.setItem(RETURN_TO_KEY, JSON.stringify({ to: returnTo, at: Date.now() })) } catch { /* storage blocked */ }
  try {
    await startSignIn(handle, returnTo)
  } catch (e) {
    try { localStorage.removeItem(RETURN_TO_KEY) } catch { /* storage blocked */ }
    throw e
  }
}

/** True when the page was opened by an authorization server's redirect. */
export function isSignInCallback(): boolean {
  if (!window.location.hash.includes("state=")) return false
  const p = new URLSearchParams(window.location.hash.slice(1))
  return p.has("state") && (p.has("code") || p.has("error")) && p.has("iss")
}

/** Run before the app starts on a callback page: finishes the sign-in and
 *  puts the address back to where the user was. */
export async function completeSignIn(): Promise<{ session: ViewSession | null; error?: string }> {
  const hash = window.location.hash
  // The code is single use: out of the address bar before anything else.
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`)
  const restore = (to: string | null) => { if (to && to.startsWith("/") && !to.startsWith("//")) window.history.replaceState(window.history.state, "", to) }
  let stored: string | null = null
  try {
    const v = JSON.parse(localStorage.getItem(RETURN_TO_KEY) ?? "null")
    localStorage.removeItem(RETURN_TO_KEY)
    if (v && typeof v.to === "string" && Date.now() - Number(v.at) < RETURN_TO_MAX_AGE_MS) stored = v.to
  } catch { /* storage blocked */ }
  restore(stored)
  try {
    const { completeSignIn: finish } = await oauth()
    const { account, returnTo } = await finish(hash)
    remember(account)
    if (!stored) restore(returnTo)
    // This document's own sessionStorage: read by the Share button as it mounts.
    try { sessionStorage.setItem(REOPEN_SHARE_KEY, "1") } catch { /* storage blocked */ }
    return { session: account }
  } catch (e) {
    return { session: null, error: (e as Error)?.message ?? "Sign-in failed" }
  }
}

export async function signOut(): Promise<void> {
  const s = session()
  remember(null)
  if (!s) return
  try { await (await oauth()).signOut(s.did) } catch { /* the local session is gone either way */ }
}

export interface SaveViewOptions {
  title?: string
  /** A picture of the view (JPEG or PNG), stored as a blob of the record. */
  thumbnail?: Blob | null
  /** The page address the short link is built on. Defaults to this page. */
  pageHref?: string
}

export interface SaveViewResult { ref: ViewRef; link: string; uri: string; hasThumbnail: boolean; thumbnailError?: string }

/** Saves a view (the query string of a link to it) to the signed-in
 *  account and returns its short link. */
export async function saveView(search: string | URLSearchParams, opts: SaveViewOptions = {}): Promise<SaveViewResult> {
  const s = session()
  if (!s) throw new Error("Sign in first.")
  const record = buildViewRecord(search, {
    title: opts.title,
    appVersion: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : undefined,
    site: window.location.host,
  })
  const mod = await oauth()
  try {
    const saved = await mod.saveView(s.did, record, opts.thumbnail)
    return { ref: saved.ref, link: viewLink(opts.pageHref ?? window.location.href, saved.ref), uri: saved.uri, hasThumbnail: !!saved.thumbnail, thumbnailError: saved.thumbnailError }
  } catch (e) {
    if (e instanceof mod.SessionExpiredError) remember(null)
    throw e
  }
}

/** The view a short link points at. No account, no server of ours. */
export function loadView(ref: ViewRef): Promise<LoadedView> {
  return loadAtprotoView(ref)
}

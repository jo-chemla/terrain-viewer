// Saved views behind short links: the one door the app goes through.
//
//   signIn(handle)            leaves for the account's authorization server
//   signOut()
//   session()                 who is signed in, from local storage (no network)
//   saveView(search, opts)    one record in the account's repository → a ref
//   loadView(ref)             anyone, no account: the record a ref points at
//   listViews(account?)       anyone, no account: an account's saved views
//   deleteView(ref)           one of the signed-in account's own
//   canPost() / allowPosting() / postView()   the opt-in "Post to Bluesky"
//
// Today the provider is the AT Protocol (lib/atproto-view.ts for the format
// and the public read, lib/atproto-oauth.ts for signing in and writing, the
// latter loaded on demand). Another provider would be another pair of files
// behind these same five functions.
import { buildPostRecord, buildViewRecord, listViews as listAtprotoViews, loadView as loadAtprotoView, oauthClientConfig, viewLink, type BlobRef, type ListedView, type LoadedView, type ViewRecord, type ViewRef } from "./atproto-view"
import { modePageHref, searchNamingMode } from "./mode-share-url"

export { parseViewRef, formatViewRef, viewLink, expandedViewUrl, maskedParamKeys, ViewLoadError, VIEW_PARAM } from "./atproto-view"
export { POST_MAX_GRAPHEMES, graphemeLength } from "./atproto-view"
export type { ViewRef, LoadedView, ListedView } from "./atproto-view"

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
export async function signIn(handle: string, withPost = false): Promise<void> {
  const { startSignIn } = await oauth()
  const returnTo = `${window.location.pathname}${window.location.search}`
  try { localStorage.setItem(RETURN_TO_KEY, JSON.stringify({ to: returnTo, at: Date.now() })) } catch { /* storage blocked */ }
  try {
    await startSignIn(handle, returnTo, withPost)
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
  try { localStorage.removeItem("tv-atproto-post-draft") } catch { /* storage blocked */ }
  if (!s) return
  try { await (await oauth()).signOut(s.did) } catch { /* the local session is gone either way */ }
}

export interface SaveViewOptions {
  title?: string
  /** A picture of the view (JPEG or PNG), stored as a blob of the record. */
  thumbnail?: Blob | null
  /** The address of the view (the Share dialog's): its query string is the
   *  record, its mode decides the page the short link sits on. Defaults to
   *  this page. */
  pageHref?: string
}

export interface SaveViewResult { ref: ViewRef; link: string; uri: string; title: string; hasThumbnail: boolean; thumbnail?: BlobRef; thumbnailError?: string }

/** The short link of a view: on the page of the mode it was saved in, so
 *  that the link's preview is that mode's (/rem/?view=…). The record itself
 *  names the mode, so the link opens right from any page. */
export function linkForView(ref: ViewRef, record: Pick<ViewRecord, "params">, rootHref: string = window.location.href): string {
  const mode = record.params?.appMode
  return viewLink(modePageHref(rootHref, typeof mode === "string" ? mode : undefined), ref)
}

/** Saves a view (the query string of a link to it) to the signed-in
 *  account and returns its short link. */
export async function saveView(opts: SaveViewOptions = {}): Promise<SaveViewResult> {
  const s = session()
  if (!s) throw new Error("Sign in first.")
  const pageHref = opts.pageHref ?? window.location.href
  // The mode is part of the view: named in the record even where the
  // address leaves it out (terrain, the default) or says it by its path.
  const record = buildViewRecord(searchNamingMode(pageHref), {
    title: opts.title,
    appVersion: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : undefined,
    site: window.location.host,
  })
  const mod = await oauth()
  try {
    const saved = await mod.saveView(s.did, record, opts.thumbnail)
    return { ref: saved.ref, link: linkForView(saved.ref, record, pageHref), uri: saved.uri, title: record.title, hasThumbnail: !!saved.thumbnail, thumbnail: saved.thumbnail, thumbnailError: saved.thumbnailError }
  } catch (e) {
    if (e instanceof mod.SessionExpiredError) remember(null)
    throw e
  }
}

/** The view a short link points at. No account, no server of ours. */
export function loadView(ref: ViewRef): Promise<LoadedView> {
  return loadAtprotoView(ref)
}

export interface SavedViewList { did: string; views: (ListedView & { link: string })[]; cursor?: string }

/** The saved views of an account (a handle or a DID; the signed-in one when
 *  none is given), newest first. A public read: no sign-in is used, so the
 *  list of anyone's views can be read the same way. */
export async function listViews(account?: string, cursor?: string): Promise<SavedViewList> {
  const repo = account ?? session()?.did
  if (!repo) throw new Error("Sign in first, or name an account.")
  const list = await listAtprotoViews(repo, { cursor })
  return { did: list.did, cursor: list.cursor, views: list.views.map((v) => ({ ...v, link: linkForView(v.ref, v.record) })) }
}

/** Deletes one of the signed-in account's saved views. Its short link then
 *  answers "this view no longer exists". */
export async function deleteView(ref: ViewRef): Promise<void> {
  const s = session()
  if (!s) throw new Error("Sign in first.")
  if (ref.repo !== s.did) throw new Error("This view belongs to another account.")
  const mod = await oauth()
  try {
    await mod.deleteView(s.did, ref.rkey)
  } catch (e) {
    if (e instanceof mod.SessionExpiredError) remember(null)
    throw e
  }
}

// ── "Post to Bluesky": opt-in, one more permission asked on the click ─────

/** A view waiting to be posted, kept across the trip to the authorization
 *  server: on the way back the editor opens on it. Nothing is posted until
 *  the user presses Post in that editor. */
export interface PostDraft { link: string; title: string; thumbnail?: BlobRef; /** An https address of the picture, for the editor. */ previewUrl?: string; did: string }
const POST_DRAFT_KEY = "tv-atproto-post-draft"

export function pendingPostDraft(): PostDraft | null {
  try {
    const v = JSON.parse(localStorage.getItem(POST_DRAFT_KEY) ?? "null")
    if (!v || typeof v.link !== "string" || typeof v.did !== "string" || Date.now() - Number(v.at) > RETURN_TO_MAX_AGE_MS) return null
    return v.did === session()?.did ? { link: v.link, title: String(v.title ?? ""), thumbnail: v.thumbnail, previewUrl: typeof v.previewUrl === "string" && v.previewUrl.startsWith("https://") ? v.previewUrl : undefined, did: v.did } : null
  } catch { return null }
}
export function clearPostDraft(): void {
  try { localStorage.removeItem(POST_DRAFT_KEY) } catch { /* storage blocked */ }
}

/** Whether the current sign-in may create a post. */
export async function canPost(): Promise<boolean> {
  const s = session()
  return s ? (await oauth()).canPost(s.did) : false
}

/** Leaves the page to ask the account's server for the permission to create
 *  posts, on top of what the sign-in already holds. `draft` comes back. */
export async function allowPosting(draft: Omit<PostDraft, "did">): Promise<void> {
  const s = session()
  if (!s) throw new Error("Sign in first.")
  try { localStorage.setItem(POST_DRAFT_KEY, JSON.stringify({ ...draft, did: s.did, at: Date.now() })) } catch { /* storage blocked */ }
  try {
    await signIn(s.did, true)
  } catch (e) {
    clearPostDraft()
    throw e
  }
}

/** Publishes the view as a post of the signed-in account: the text the user
 *  wrote, and a card (title, description, the view's picture) that the post
 *  itself carries. */
export async function postView(opts: { text: string; link: string; title: string; description?: string; thumbnail?: BlobRef }): Promise<{ uri: string; url: string }> {
  const s = session()
  if (!s) throw new Error("Sign in first.")
  const record = buildPostRecord({ text: opts.text, link: opts.link, title: opts.title, description: opts.description, thumb: opts.thumbnail })
  const mod = await oauth()
  try {
    const out = await mod.createPost(s.did, record)
    clearPostDraft()
    return { uri: out.uri, url: `https://bsky.app/profile/${s.did}/post/${out.rkey}` }
  } catch (e) {
    if (e instanceof mod.SessionExpiredError) remember(null)
    throw e
  }
}

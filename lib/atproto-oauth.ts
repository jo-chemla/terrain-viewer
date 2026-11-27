// Signing in with an AT Protocol account from the browser, and writing a
// view to the account's own repository. The only file that imports the
// atproto client (@atcute/oauth-browser-client): lib/view-sharing.ts loads
// it with a dynamic import, so the app's start does not carry it.
//
// A public OAuth client: no secret, no server of ours. The authorization
// server (the account's PDS, or Bluesky's entryway) reads the client's
// metadata from a static file of this site (public/atproto/<host>.json),
// the tokens are bound to a DPoP key made in this browser, and both stay in
// this origin's localStorage (the library's choice: it works where IndexedDB
// does not, at the price of a key that script on this page can read). A
// public client's session lasts two weeks on the reference server; after
// that, sign in again.
import { configureOAuth, createAuthorizationUrl, finalizeAuthorization, getSession, deleteStoredSession, OAuthUserAgent } from "@atcute/oauth-browser-client"
import { CompositeDidDocumentResolver, CompositeHandleResolver, DohJsonHandleResolver, LocalActorResolver, PlcDidDocumentResolver, WebDidDocumentResolver, XrpcHandleResolver } from "@atcute/identity-resolver"
import { OAUTH_SCOPE, VIEW_COLLECTION, handleOfDid, isDid, isHandle, oauthClientConfig, type BlobRef, type ViewRecord, type ViewRef } from "./atproto-view"

export interface Account { did: string; handle: string | null }

let configured = false
function configure(): void {
  if (configured) return
  const client = oauthClientConfig(window.location)
  if (!client.ok) throw new Error(client.reason)
  configureOAuth({
    metadata: { client_id: client.client_id, redirect_uri: client.redirect_uri },
    storageName: "tv-atproto-oauth",
    identityResolver: new LocalActorResolver({
      // A browser has no DNS: Bluesky's public API resolves any handle, a
      // DNS-over-HTTPS query runs beside it (whichever answers first).
      handleResolver: new CompositeHandleResolver({
        strategy: "race",
        methods: {
          http: new XrpcHandleResolver({ serviceUrl: "https://public.api.bsky.app" }),
          dns: new DohJsonHandleResolver({ dohUrl: "https://cloudflare-dns.com/dns-query" }),
        },
      }),
      didDocumentResolver: new CompositeDidDocumentResolver({
        methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() },
      }),
    }),
  })
  configured = true
}

/** Leaves the page for the account's authorization server. `returnTo` (a
 *  path and query of this site) comes back from completeSignIn. */
export async function startSignIn(identifier: string, returnTo: string): Promise<never> {
  configure()
  const id = identifier.trim().replace(/^@/, "")
  // A handle or a DID names an account; an https address names a server
  // (a self-hosted PDS where the account is not known yet).
  const target = /^https:\/\//i.test(id)
    ? { type: "pds" as const, serviceUrl: id.replace(/\/+$/, "") }
    : isDid(id) || isHandle(id)
      ? { type: "account" as const, identifier: id as any }
      : null
  if (!target) throw new Error("Enter a handle (alice.bsky.social), a DID, or the https address of your server.")
  const url = await createAuthorizationUrl({ target, scope: OAUTH_SCOPE, state: { returnTo } })
  // The library's own advice: let the browser write the pending state to
  // storage before the page goes away.
  await new Promise((r) => setTimeout(r, 200))
  window.location.assign(url)
  return new Promise<never>(() => {})
}

/** The second half, on the page the server redirects to: exchanges the code
 *  for the session, kept by the library in localStorage. */
export async function completeSignIn(hash: string): Promise<{ account: Account; returnTo: string | null }> {
  configure()
  const { session, state } = await finalizeAuthorization(new URLSearchParams(hash.replace(/^#/, "")))
  const did = session.info.sub
  const returnTo = typeof (state as any)?.returnTo === "string" ? (state as any).returnTo as string : null
  return { account: { did, handle: await handleOfDid(did) }, returnTo }
}

async function agentFor(did: string): Promise<OAuthUserAgent> {
  configure()
  try {
    return new OAuthUserAgent(await getSession(did as any, { allowStale: false }))
  } catch {
    throw new SessionExpiredError()
  }
}

/** The stored session is gone or can no longer be refreshed. */
export class SessionExpiredError extends Error {
  constructor() {
    super("The sign-in has expired (a browser-only session lasts two weeks). Sign in again.")
    this.name = "SessionExpiredError"
  }
}

export async function signOut(did: string): Promise<void> {
  configure()
  try {
    const agent = new OAuthUserAgent(await getSession(did as any, { allowStale: true }))
    await agent.signOut()
  } catch {
    deleteStoredSession(did as any)
  }
}

async function xrpc(agent: OAuthUserAgent, method: string, init: RequestInit): Promise<any> {
  const res = await agent.handle(`/xrpc/${method}`, init)
  let body: any = null
  try { body = await res.json() } catch { /* empty or not JSON */ }
  if (res.status === 401) throw new SessionExpiredError()
  if (!res.ok) throw new Error(`${method}: ${body?.message ?? body?.error ?? `HTTP ${res.status}`}`)
  return body
}

export interface SavedView { ref: ViewRef; uri: string; cid?: string; thumbnail?: BlobRef; thumbnailError?: string }

/** Writes one record (and first its thumbnail, a blob the record then
 *  references: a PDS drops a blob no record points at). A thumbnail that
 *  the server refuses does not stop the save. */
export async function saveView(did: string, record: ViewRecord, thumbnail?: Blob | null): Promise<SavedView> {
  const agent = await agentFor(did)
  let blob: BlobRef | undefined
  let thumbnailError: string | undefined
  if (thumbnail) {
    try {
      const out = await xrpc(agent, "com.atproto.repo.uploadBlob", { method: "POST", headers: { "content-type": thumbnail.type || "image/jpeg" }, body: thumbnail })
      blob = out?.blob as BlobRef
    } catch (e) {
      if (e instanceof SessionExpiredError) throw e
      thumbnailError = (e as Error).message
    }
  }
  const out = await xrpc(agent, "com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: did, collection: VIEW_COLLECTION, record: blob ? { ...record, thumbnail: blob } : record }),
  })
  const uri = String(out?.uri ?? "")
  const rkey = uri.split("/").pop() ?? ""
  if (!rkey) throw new Error("The server accepted the view but returned no address for it.")
  return { ref: { repo: did, rkey }, uri, cid: out?.cid, thumbnail: blob, thumbnailError }
}

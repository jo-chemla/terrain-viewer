// A saved view as one AT Protocol record, and the short link that points at
// it: ?view=at/<did>/<rkey>.
//
// The app's shareable state is its query string (nuqs writes only what
// differs from a default), so a view is that query string, key by key, in a
// record of the signed-in user's own repository (their PDS). Reading one
// back needs no account and no server of ours: the DID names the PDS (PLC
// directory, or the did:web host), and com.atproto.repo.getRecord on that
// PDS is public and answers with Access-Control-Allow-Origin: *.
//
// This file is the part with no dependency: the reference, the record, and
// the read path, all plain fetch. Signing in and writing are in
// lib/atproto-oauth.ts (the only file that imports the atproto client); the
// app goes through lib/view-sharing.ts.

/** The record type. An NSID is a reversed domain name the author controls:
 *  iconem.com, then the app, then the record's name. */
export const VIEW_COLLECTION = "com.iconem.terrainviewer.view"
/** Bumped when the record's shape changes in a way a reader must know. */
export const VIEW_SCHEMA_VERSION = 1
/** The query parameter of a short link. */
export const VIEW_PARAM = "view"

export interface ViewRef {
  /** A DID (did:plc:…, did:web:…) or a handle (alice.bsky.social). */
  repo: string
  rkey: string
}

/** An atproto blob as a record carries it. */
export interface BlobRef {
  $type: "blob"
  ref: { $link: string }
  mimeType: string
  size: number
}

export interface ViewRecord {
  $type: typeof VIEW_COLLECTION
  /** Shown in lists of saved views. */
  title: string
  /** ISO 8601. */
  createdAt: string
  schemaVersion: number
  /** The build that wrote the record (a commit hash), for later migrations. */
  appVersion?: string
  /** The host the view was saved from (terrain-viewer.iconem.com, …). */
  site?: string
  /** The query string, key by key, as the address bar spells it. Values are
   *  strings: the atproto data model has no floats, and the URL spelling is
   *  what the app already knows how to read. A repeated key is a list. */
  params: Record<string, string | string[]>
  thumbnail?: BlobRef
}

// did:plc is 24 base32 characters; did:web is a host, with %3A for a port and
// colons for path segments.
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+(:[A-Za-z0-9.%_-]+)*)$/
const HANDLE_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/i
// Record keys: the atproto rule, minus the two reserved values.
const RKEY_RE = /^[A-Za-z0-9._:~-]{1,512}$/

export const isDid = (s: string): boolean => DID_RE.test(s)
export const isHandle = (s: string): boolean => s.length <= 253 && HANDLE_RE.test(s)

/** `at/<did or handle>/<rkey>`, the value of ?view=. An at:// address of a
 *  record of this collection is accepted too (pasted from a repo browser).
 *  Null when it is neither. */
export function parseViewRef(value: string | null | undefined): ViewRef | null {
  if (!value) return null
  let v = value.trim()
  const uri = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(v)
  if (uri) {
    if (uri[2] !== VIEW_COLLECTION) return null
    v = `at/${uri[1]}/${uri[3]}`
  }
  const parts = v.split("/")
  if (parts.length !== 3 || parts[0] !== "at") return null
  const repo = parts[1].replace(/^@/, "")
  const rkey = parts[2]
  if (!RKEY_RE.test(rkey) || rkey === "." || rkey === "..") return null
  if (isDid(repo)) return { repo, rkey }
  if (isHandle(repo)) return { repo: repo.toLowerCase(), rkey }
  return null
}

export const formatViewRef = (ref: ViewRef): string => `at/${ref.repo}/${ref.rkey}`

/** The short link: this page's address with ?view= and nothing else. */
export function viewLink(pageHref: string, ref: ViewRef): string {
  const url = new URL(pageHref)
  // Colons and slashes are legal in a query value: left readable.
  return `${url.origin}${url.pathname}?${VIEW_PARAM}=${formatViewRef(ref)}`
}

// ── the record ───────────────────────────────────────────────────────────

// Never part of a view: the pointer itself, the one-shot parameters a link
// may carry (they act on arrival, they are not state), and anything named
// like a credential. The app keeps its API keys in local storage, never in
// the address bar; this is the second lock on a record that is public and
// that its author cannot take back from every copy.
const ONE_SHOT_PARAMS = new Set([VIEW_PARAM, "openSections", "closeSections", "bookmarksUrl", "scrollTo", "startTour", "bookmarksGallery", "openLibrary", "openDialog"])
const SECRET_NAME_RE = /(key|token|secret|password|passwd|credential|signature)$|^(sig|auth|authorization)$/i
// Credentials inside a value (a tile URL saved with its key): the value is
// kept, the credential becomes a placeholder. The two the app can fill back
// from the reader's own settings keep the app's placeholder names
// (lib/key-placeholders.ts).
const SH_OGC_RE = /(sh\.dataspace\.copernicus\.eu\/ogc\/(?:wms|wmts)\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const PLANET_KEY_RE = /(https:\/\/tiles\d?\.planet\.com\/[^\s,]*?[?&]api_key=)[^&\s,]+/gi
const SECRET_QUERY_NAMES = "api[_-]?key|apikey|key|access[_-]?token|token|subscription-key|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token"
const VALUE_SECRET_RE = new RegExp(`([?&](?:${SECRET_QUERY_NAMES})=)[^&\\s,#]+`, "gi")
// The same inside a URL that is itself percent-encoded in the value
// (?sourceNames= and ?sourceMeta= carry each source URL that way).
const ENCODED_SECRET_RE = new RegExp(`((?:%3F|%26)(?:${SECRET_QUERY_NAMES})%3D)(?:(?!%26|%23|%2C)[^&\\s,=#])+`, "gi")

/** A parameter value with the credentials it may embed replaced by a
 *  placeholder. A source whose URL held a key then loads for a reader only
 *  where the app can fill it from their own settings (Planet, Sentinel Hub). */
export function maskSecretsInValue(value: string): string {
  return value
    .replace(SH_OGC_RE, "$1{shInstance}")
    .replace(PLANET_KEY_RE, "$1{planetKey}")
    .replace(VALUE_SECRET_RE, (m, head: string) => (/\{(planetKey|shInstance)\}$/.test(m) ? m : `${head}{key}`))
    .replace(ENCODED_SECRET_RE, (m, head: string) => (/%7B(planetKey|shInstance)%7D$/i.test(m) ? m : `${head}%7Bkey%7D`))
}

/** The parameters whose value held a credential that a record would mask. */
export function maskedParamKeys(search: string | URLSearchParams): string[] {
  const params = typeof search === "string" ? new URLSearchParams(search) : search
  const out = new Set<string>()
  for (const [key, raw] of params.entries()) if (!SECRET_NAME_RE.test(key) && maskSecretsInValue(raw) !== raw) out.add(key)
  return Array.from(out)
}

/** The parameters a record keeps, from a query string: one-shot and
 *  credential-named ones dropped, empty ones dropped, credentials inside
 *  values masked. The query string already holds only what differs from a
 *  default (nuqs clears a field that is back at its default). */
export function viewParams(search: string | URLSearchParams): Record<string, string | string[]> {
  const params = typeof search === "string" ? new URLSearchParams(search) : search
  const out: Record<string, string | string[]> = {}
  for (const [key, raw] of params.entries()) {
    if (ONE_SHOT_PARAMS.has(key) || SECRET_NAME_RE.test(key) || raw === "") continue
    const value = maskSecretsInValue(raw)
    const prev = out[key]
    if (prev === undefined) out[key] = value
    else if (Array.isArray(prev)) prev.push(value)
    else out[key] = [prev, value]
  }
  return out
}

export interface BuildViewOptions {
  title?: string
  /** Defaults to now. */
  createdAt?: Date
  appVersion?: string
  site?: string
  thumbnail?: BlobRef
}

/** The record of a view, from the page's query string. */
export function buildViewRecord(search: string | URLSearchParams, opts: BuildViewOptions = {}): ViewRecord {
  const record: ViewRecord = {
    $type: VIEW_COLLECTION,
    title: (opts.title ?? "").trim().slice(0, 300) || "Untitled view",
    createdAt: (opts.createdAt ?? new Date()).toISOString(),
    schemaVersion: VIEW_SCHEMA_VERSION,
    params: viewParams(search),
  }
  if (opts.appVersion) record.appVersion = opts.appVersion
  if (opts.site) record.site = opts.site
  if (opts.thumbnail) record.thumbnail = opts.thumbnail
  return record
}

/** A record as a query string, the reverse of viewParams. The same filter
 *  runs on the way in: a record is somebody else's data. */
export function viewRecordToSearch(record: Pick<ViewRecord, "params">): URLSearchParams {
  const out = new URLSearchParams()
  for (const [key, value] of Object.entries(record.params ?? {})) {
    if (ONE_SHOT_PARAMS.has(key) || SECRET_NAME_RE.test(key)) continue
    for (const v of Array.isArray(value) ? value : [value]) if (typeof v === "string") out.append(key, v)
  }
  return out
}

function isViewRecord(value: unknown): value is ViewRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  if (v.$type !== VIEW_COLLECTION || !v.params || typeof v.params !== "object" || Array.isArray(v.params)) return false
  return Object.values(v.params as object).every((p) => typeof p === "string" || (Array.isArray(p) && p.every((x) => typeof x === "string")))
}

// ── the read path: no account, no server of ours ─────────────────────────

export type ViewLoadErrorKind = "bad-ref" | "identity" | "pds-unreachable" | "not-found" | "invalid-record" | "newer-schema"

/** What went wrong, in words for the reader (`message`) and as a kind. */
export class ViewLoadError extends Error {
  kind: ViewLoadErrorKind
  constructor(kind: ViewLoadErrorKind, message: string) {
    super(message)
    this.name = "ViewLoadError"
    this.kind = kind
  }
}

export interface LoadOptions {
  fetch?: typeof fetch
  /** Per request, in ms. */
  timeoutMs?: number
}

const PLC_DIRECTORY = "https://plc.directory"
// A browser cannot read DNS TXT records: Bluesky's public API resolves any
// handle (not only bsky.social ones), a DNS-over-HTTPS query is the second
// try, the handle's own /.well-known the third (often without CORS).
const HANDLE_RESOLVER = "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
const DOH = "https://cloudflare-dns.com/dns-query"

async function getJson(url: string, opts: LoadOptions, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  const f = opts.fetch ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000)
  try {
    const res = await f(url, { signal: controller.signal, headers })
    let body: any = null
    try { body = await res.json() } catch { /* not JSON */ }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

/** A handle's DID. */
export async function resolveHandle(handle: string, opts: LoadOptions = {}): Promise<string> {
  try {
    const { status, body } = await getJson(`${HANDLE_RESOLVER}?handle=${encodeURIComponent(handle)}`, opts)
    if (status === 200 && typeof body?.did === "string" && isDid(body.did)) return body.did
  } catch { /* next */ }
  try {
    const { status, body } = await getJson(`${DOH}?name=${encodeURIComponent(`_atproto.${handle}`)}&type=TXT`, opts, { accept: "application/dns-json" })
    if (status === 200) {
      for (const a of (body?.Answer ?? []) as { data?: string }[]) {
        const m = /did=(did:[a-z]+:[A-Za-z0-9.%:_-]+)/.exec(String(a.data ?? "").replace(/"/g, ""))
        if (m && isDid(m[1])) return m[1]
      }
    }
  } catch { /* next */ }
  try {
    const f = opts.fetch ?? fetch
    const res = await f(`https://${handle}/.well-known/atproto-did`)
    const text = (await res.text()).trim()
    if (res.ok && isDid(text)) return text
  } catch { /* none left */ }
  throw new ViewLoadError("identity", `The account "${handle}" could not be found: no AT Protocol identity answers to that handle.`)
}

/** A DID's document: PLC directory, or the did:web host. */
async function fetchDidDocument(did: string, opts: LoadOptions): Promise<any> {
  let url: string
  if (did.startsWith("did:plc:")) url = `${PLC_DIRECTORY}/${did}`
  else {
    // did:web:host[:path…], %3A for a port.
    const [host, ...path] = did.slice("did:web:".length).split(":")
    url = `https://${decodeURIComponent(host)}/${path.length ? `${path.map(decodeURIComponent).join("/")}/did.json` : ".well-known/did.json"}`
  }
  let res: { status: number; body: any }
  try { res = await getJson(url, opts) } catch {
    throw new ViewLoadError("identity", `The identity directory did not answer for ${did} (${new URL(url).host}). Check the connection and try again.`)
  }
  if (res.status === 404 || res.status === 410) throw new ViewLoadError("identity", `The account ${did} does not exist (or was deleted).`)
  if (res.status !== 200 || !res.body) throw new ViewLoadError("identity", `The identity directory answered with an error for ${did} (${res.status}).`)
  return res.body
}

/** The PDS a DID's document names. */
export async function resolvePds(did: string, opts: LoadOptions = {}): Promise<string> {
  const doc = await fetchDidDocument(did, opts)
  const services = (doc.service ?? []) as { id?: string; type?: string; serviceEndpoint?: unknown }[]
  const pds = services.find((s) => typeof s.id === "string" && s.id.endsWith("#atproto_pds") && s.type === "AtprotoPersonalDataServer")
  const endpoint = typeof pds?.serviceEndpoint === "string" ? pds.serviceEndpoint.replace(/\/+$/, "") : ""
  if (!/^https:\/\/[^/]+$/.test(endpoint)) throw new ViewLoadError("identity", `The identity document of ${did} names no data server.`)
  return endpoint
}

/** The handle a DID's document claims (not verified both ways: for display). */
export async function handleOfDid(did: string, opts: LoadOptions = {}): Promise<string | null> {
  try {
    const doc = await fetchDidDocument(did, opts)
    const aka = ((doc.alsoKnownAs ?? []) as unknown[]).find((a) => typeof a === "string" && a.startsWith("at://"))
    const handle = typeof aka === "string" ? aka.slice("at://".length) : ""
    return isHandle(handle) ? handle : null
  } catch { return null }
}

export interface FetchedRecord { did: string; pds: string; uri: string; cid?: string; value: unknown }

/** One public record of any collection, read from its author's PDS. */
export async function fetchRecord(ref: ViewRef, collection: string, opts: LoadOptions = {}): Promise<FetchedRecord> {
  const did = isDid(ref.repo) ? ref.repo : await resolveHandle(ref.repo, opts)
  const pds = await resolvePds(did, opts)
  const host = new URL(pds).host
  let res: { status: number; body: any }
  try {
    res = await getJson(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(ref.rkey)}`, opts)
  } catch {
    throw new ViewLoadError("pds-unreachable", `The server that holds this view (${host}) did not answer. It may be down for a moment: try the link again later.`)
  }
  const error = String(res.body?.error ?? "")
  if (error === "RecordNotFound" || res.status === 404) throw new ViewLoadError("not-found", `This view no longer exists: its author deleted it (or the link is mistyped).`)
  if (error === "RepoNotFound" || error === "RepoDeactivated" || error === "RepoTakendown" || error === "RepoSuspended") throw new ViewLoadError("not-found", `The account that saved this view is gone from ${host} (deleted, deactivated or moved).`)
  if (res.status !== 200 || !res.body || res.body.value === undefined) throw new ViewLoadError("pds-unreachable", `The server that holds this view (${host}) answered with an error (${res.status}${error ? `, ${error}` : ""}).`)
  return { did, pds, uri: String(res.body.uri ?? `at://${did}/${collection}/${ref.rkey}`), cid: typeof res.body.cid === "string" ? res.body.cid : undefined, value: res.body.value }
}

export interface LoadedView { ref: ViewRef; did: string; pds: string; record: ViewRecord; thumbnailUrl?: string }

/** The view a reference points at. Throws a ViewLoadError that says why. */
export async function loadView(ref: ViewRef, opts: LoadOptions = {}): Promise<LoadedView> {
  const fetched = await fetchRecord(ref, VIEW_COLLECTION, opts)
  if (!isViewRecord(fetched.value)) throw new ViewLoadError("invalid-record", "The record this link points at is not a Terrain Viewer view.")
  const record = fetched.value
  if (typeof record.schemaVersion === "number" && record.schemaVersion > VIEW_SCHEMA_VERSION) {
    throw new ViewLoadError("newer-schema", "This view was saved by a newer version of the app. Reload the page to get the current version, then open the link again.")
  }
  const cid = record.thumbnail?.ref?.$link
  return { ref, did: fetched.did, pds: fetched.pds, record, thumbnailUrl: cid ? blobUrl(fetched.pds, fetched.did, cid) : undefined }
}

export interface ListedView { ref: ViewRef; uri: string; cid?: string; record: ViewRecord; thumbnailUrl?: string }
export interface ViewList { did: string; pds: string; views: ListedView[]; cursor?: string }

/** The saved views of an account, newest first: `com.atproto.repo.listRecords`
 *  on its PDS, public like getRecord (no account, CORS open). `repo` is a DID
 *  or a handle. Records of the collection that are not views (or that a newer
 *  app wrote in a shape this one cannot read) are left out. */
export async function listViews(repo: string, opts: LoadOptions & { limit?: number; cursor?: string } = {}): Promise<ViewList> {
  const id = repo.trim().replace(/^@/, "")
  if (!isDid(id) && !isHandle(id)) throw new ViewLoadError("bad-ref", `"${id.slice(0, 80)}" is neither a handle (alice.bsky.social) nor a DID.`)
  const did = isDid(id) ? id : await resolveHandle(id.toLowerCase(), opts)
  const pds = await resolvePds(did, opts)
  const host = new URL(pds).host
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50))
  let res: { status: number; body: any }
  try {
    res = await getJson(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(VIEW_COLLECTION)}&limit=${limit}${opts.cursor ? `&cursor=${encodeURIComponent(opts.cursor)}` : ""}`, opts)
  } catch {
    throw new ViewLoadError("pds-unreachable", `The server that holds this account's views (${host}) did not answer. Try again later.`)
  }
  const error = String(res.body?.error ?? "")
  if (error === "RepoNotFound" || error === "RepoDeactivated" || error === "RepoTakendown" || error === "RepoSuspended") throw new ViewLoadError("not-found", `The account is gone from ${host} (deleted, deactivated or moved).`)
  if (res.status !== 200 || !Array.isArray(res.body?.records)) throw new ViewLoadError("pds-unreachable", `The server that holds this account's views (${host}) answered with an error (${res.status}${error ? `, ${error}` : ""}).`)
  const views: ListedView[] = []
  for (const r of res.body.records as { uri?: unknown; cid?: unknown; value?: unknown }[]) {
    const uri = String(r.uri ?? "")
    const rkey = uri.split("/").pop() ?? ""
    if (!isViewRecord(r.value) || !RKEY_RE.test(rkey)) continue
    if (typeof r.value.schemaVersion === "number" && r.value.schemaVersion > VIEW_SCHEMA_VERSION) continue
    const cid = r.value.thumbnail?.ref?.$link
    views.push({ ref: { repo: did, rkey }, uri, cid: typeof r.cid === "string" ? r.cid : undefined, record: r.value, thumbnailUrl: cid ? blobUrl(pds, did, cid) : undefined })
  }
  return { did, pds, views, cursor: typeof res.body.cursor === "string" && res.body.cursor ? res.body.cursor : undefined }
}

/** A blob's public address on its PDS. Served as an attachment with a
 *  sandbox policy: fine for <img> and for fetch, not a page to open. */
export const blobUrl = (pds: string, did: string, cid: string): string =>
  `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`

/** The address a short link expands to: this page, with the record's
 *  parameters as its query string. `rename` is the legacy-key migration
 *  (lib/url-keys.ts), applied as it is to any link. */
export function expandedViewUrl(pageHref: string, record: Pick<ViewRecord, "params">, rename?: (p: URLSearchParams) => unknown): string {
  const url = new URL(pageHref)
  const params = viewRecordToSearch(record)
  rename?.(params)
  const q = params.toString()
  return `${url.origin}${url.pathname}${q ? `?${q}` : ""}`
}

// ── the OAuth client's identity, per host ────────────────────────────────

/** What a sign-in asks for: records of the app's own collection (create,
 *  update, delete) and pictures (the thumbnail). Nothing of the account's
 *  posts, follows or messages. */
export const OAUTH_SCOPE = `atproto repo:${VIEW_COLLECTION} blob:image/*`
/** The one more permission "Post to Bluesky" asks for, and only when the
 *  user clicks it: creating a post (not editing or deleting one, nothing
 *  else of the account). */
export const POST_COLLECTION = "app.bsky.feed.post"
export const OAUTH_POST_PERMISSION = `repo:${POST_COLLECTION}?action=create`
export const OAUTH_SCOPE_WITH_POST = `${OAUTH_SCOPE} ${OAUTH_POST_PERMISSION}`
/** What the client metadata declares: the most the app may ever ask for. An
 *  authorization request names a subset of it (OAuth: the granted scope is
 *  the requested one, not the declared one), so a plain sign-in still gets
 *  OAUTH_SCOPE and nothing more. */
export const OAUTH_SCOPE_DECLARED = OAUTH_SCOPE_WITH_POST

/** Whether a granted scope (a session's) lets the app create a post. */
export function scopeAllowsPost(scope: string | null | undefined): boolean {
  for (const part of String(scope ?? "").split(/\s+/)) {
    if (part === "transition:generic") return true
    const m = /^repo:([^?]+)(?:\?(.*))?$/.exec(part)
    if (!m || (m[1] !== POST_COLLECTION && m[1] !== "*")) continue
    const actions = new URLSearchParams(m[2] ?? "").getAll("action")
    if (actions.length === 0 || actions.includes("create")) return true
  }
  return false
}

// ── a post that carries the view as its card ─────────────────────────────

export interface PostRecord {
  $type: typeof POST_COLLECTION
  text: string
  createdAt: string
  facets?: { index: { byteStart: number; byteEnd: number }; features: { $type: "app.bsky.richtext.facet#link"; uri: string }[] }[]
  embed: { $type: "app.bsky.embed.external"; external: { uri: string; title: string; description: string; thumb?: BlobRef } }
}

/** A post's length limit: 300 graphemes (and 3000 bytes). */
export const POST_MAX_GRAPHEMES = 300
export function graphemeLength(text: string): number {
  const Seg = (Intl as any).Segmenter
  if (typeof Seg !== "function") return Array.from(text).length
  let n = 0
  for (const _ of new Seg().segment(text)) n++
  return n
}

export interface BuildPostOptions { text: string; link: string; title: string; description?: string; thumb?: BlobRef; createdAt?: Date }

/** The post record: the user's text, and the view as an external embed. The
 *  card's title, description and picture are supplied here by the client, so
 *  no crawler reads the page. Where the text holds the link, a facet makes
 *  it clickable (offsets count UTF-8 bytes). */
export function buildPostRecord(opts: BuildPostOptions): PostRecord {
  const text = opts.text.trim()
  if (graphemeLength(text) > POST_MAX_GRAPHEMES) throw new Error(`The post is longer than ${POST_MAX_GRAPHEMES} characters.`)
  const record: PostRecord = {
    $type: POST_COLLECTION,
    text,
    createdAt: (opts.createdAt ?? new Date()).toISOString(),
    embed: { $type: "app.bsky.embed.external", external: { uri: opts.link, title: opts.title.slice(0, 300), description: (opts.description ?? "").slice(0, 1000) } },
  }
  if (opts.thumb) record.embed.external.thumb = opts.thumb
  const at = text.indexOf(opts.link)
  if (at >= 0) {
    const enc = new TextEncoder()
    const byteStart = enc.encode(text.slice(0, at)).length
    record.facets = [{ index: { byteStart, byteEnd: byteStart + enc.encode(opts.link).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: opts.link }] }]
  }
  return record
}

/** The hosts that serve a client metadata file (public/atproto/<host>.json).
 *  An atproto client is identified by the https address of that file, and
 *  its redirect address must be on the same host: one file per site. */
export const OAUTH_CLIENT_HOSTS = ["terrain-viewer.iconem.com", "historical-satellite.iconem.com"]

export type OAuthClientConfig =
  | { ok: true; kind: "web" | "loopback"; client_id: string; redirect_uri: string }
  | { ok: false; reason: string }

/** The client this page is, from its address. */
export function oauthClientConfig(loc: { protocol: string; hostname: string; port: string; pathname?: string; search?: string }): OAuthClientConfig {
  const host = loc.hostname
  if (loc.protocol === "https:" && OAUTH_CLIENT_HOSTS.includes(host)) {
    return { ok: true, kind: "web", client_id: `https://${host}/atproto/${host}.json`, redirect_uri: `https://${host}/` }
  }
  // Development: the protocol's loopback client. Its id is http://localhost
  // (no port) with the redirect address and the scope as parameters, and the
  // redirect must be an IP literal, so the page itself has to be open on
  // 127.0.0.1: the session is stored per origin.
  if (loc.protocol === "http:" && (host === "127.0.0.1" || host === "[::1]")) {
    const redirect_uri = `http://${host}${loc.port ? `:${loc.port}` : ""}/`
    return { ok: true, kind: "loopback", client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirect_uri)}&scope=${encodeURIComponent(OAUTH_SCOPE_DECLARED)}`, redirect_uri }
  }
  if (loc.protocol === "http:" && host === "localhost") {
    return { ok: false, reason: `Sign-in does not work on http://localhost: open this page on http://127.0.0.1${loc.port ? `:${loc.port}` : ""}${loc.pathname ?? "/"}${loc.search ?? ""} instead (the AT Protocol's development client only redirects to an IP address).` }
  }
  return { ok: false, reason: `Sign-in is set up for ${OAUTH_CLIENT_HOSTS.join(" and ")} only: this copy of the app (${host || "a local file"}) has no client metadata file.` }
}

/** The metadata file of one host, as public/atproto/<host>.json holds it. */
export function oauthClientMetadata(host: string): Record<string, unknown> {
  return {
    client_id: `https://${host}/atproto/${host}.json`,
    client_name: host === "historical-satellite.iconem.com" ? "Historical Satellite (Terrain Viewer)" : "Terrain Viewer",
    client_uri: `https://${host}`,
    logo_uri: `https://${host}/${host === "historical-satellite.iconem.com" ? "favicon-historical.svg" : "favicon.svg"}`,
    redirect_uris: [`https://${host}/`],
    scope: OAUTH_SCOPE_DECLARED,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  }
}

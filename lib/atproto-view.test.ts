// Run with: node scripts/test-lib.mjs lib/atproto-view.test.ts
// Offline: fetch is a stub answering from lib/fixtures/atproto-view.json.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  OAUTH_CLIENT_HOSTS, OAUTH_SCOPE, VIEW_COLLECTION, ViewLoadError, blobUrl, buildViewRecord, expandedViewUrl, formatViewRef,
  loadView, maskSecretsInValue, maskedParamKeys, oauthClientConfig, oauthClientMetadata, parseViewRef, viewLink, viewParams, viewRecordToSearch,
} from "./atproto-view.ts"
import fixture from "./fixtures/atproto-view.json"

const DID = fixture.did

// ── the reference ────────────────────────────────────────────────────────

test("a reference is at/<did>/<rkey>, the DID kept as written", () => {
  assert.deepEqual(parseViewRef(`at/${DID}/3m7abcdefgh2k`), { repo: DID, rkey: "3m7abcdefgh2k" })
  assert.deepEqual(parseViewRef("at/did:web:pds.example.com/self"), { repo: "did:web:pds.example.com", rkey: "self" })
  assert.deepEqual(parseViewRef("at/did:web:localhost%3A2583/abc"), { repo: "did:web:localhost%3A2583", rkey: "abc" })
})

test("a handle stands in for the DID, lower-cased, a leading @ dropped", () => {
  assert.deepEqual(parseViewRef("at/Alice.Bsky.Social/3m7abcdefgh2k"), { repo: "alice.bsky.social", rkey: "3m7abcdefgh2k" })
  assert.deepEqual(parseViewRef("at/@iconem.com/3m7abcdefgh2k"), { repo: "iconem.com", rkey: "3m7abcdefgh2k" })
})

test("an at:// address of a view record is accepted, of another collection refused", () => {
  assert.deepEqual(parseViewRef(`at://${DID}/${VIEW_COLLECTION}/3m7abcdefgh2k`), { repo: DID, rkey: "3m7abcdefgh2k" })
  assert.equal(parseViewRef(`at://${DID}/app.bsky.feed.post/3m7abcdefgh2k`), null)
})

test("anything else is not a reference", () => {
  for (const bad of [null, undefined, "", "at", "at/", `at/${DID}`, `at/${DID}/`, `at/${DID}/a/b`, `atproto/${DID}/abc`, "at/did:plc:tooshort/abc",
    "at/did:key:z6Mk/abc", "at/nodots/abc", "at/https://evil.example/abc", `at/${DID}/..`, `at/${DID}/.`, `at/${DID}/has space`, `at/${DID}/a?b`, "at/-bad.example/abc"]) {
    assert.equal(parseViewRef(bad as any), null, String(bad))
  }
})

test("format and link: the short link carries the pointer and nothing else", () => {
  const ref = { repo: DID, rkey: "3m7abcdefgh2k" }
  assert.equal(formatViewRef(ref), `at/${DID}/3m7abcdefgh2k`)
  const link = viewLink("https://terrain-viewer.iconem.com/?lat=45&lng=6&showSlope=true#x", ref)
  assert.equal(link, `https://terrain-viewer.iconem.com/?view=at/${DID}/3m7abcdefgh2k`)
  assert.deepEqual(parseViewRef(new URL(link).searchParams.get("view")), ref)
  assert.ok(link.length < 100)
})

// ── the record ───────────────────────────────────────────────────────────

test("the record holds the query string as it is: only what the link holds, values as strings", () => {
  // nuqs leaves a field at its default out of the address: nothing to drop
  // here, and nothing is added.
  const r = buildViewRecord("?zoom=12.4&lat=45.8326&lng=6.8652&showSlope=true&terrainSourceA=mapterhorn", {
    title: "  Mont Blanc  ", createdAt: new Date("2026-11-27T10:00:00Z"), appVersion: "d4c869f", site: "terrain-viewer.iconem.com",
  })
  assert.deepEqual(r, {
    $type: "com.iconem.terrainviewer.view",
    title: "Mont Blanc",
    createdAt: "2026-11-27T10:00:00.000Z",
    schemaVersion: 1,
    params: { zoom: "12.4", lat: "45.8326", lng: "6.8652", showSlope: "true", terrainSourceA: "mapterhorn" },
    appVersion: "d4c869f",
    site: "terrain-viewer.iconem.com",
  })
  // The atproto data model has no floats: every value must be a string.
  for (const v of Object.values(r.params)) assert.equal(typeof v, "string")
})

test("an empty view is a record with no parameters and a default title", () => {
  const r = buildViewRecord("")
  assert.deepEqual(r.params, {})
  assert.equal(r.title, "Untitled view")
  assert.equal("thumbnail" in r, false)
})

test("empty values, the pointer and one-shot parameters are dropped", () => {
  assert.deepEqual(viewParams("?lat=1&empty=&view=at/x.example/abc&openSections=hillshade&closeSections=general&bookmarksUrl=https://x/b.json"), { lat: "1" })
})

test("a parameter named like a credential never enters the record", () => {
  const p = viewParams("?lat=1&planetKey=PLAK123&mapboxKey=pk.abc&accessToken=t&api_key=k&token=t&password=p&auth=a&sig=s")
  assert.deepEqual(p, { lat: "1" })
})

test("a credential inside a source address is masked, the address kept", () => {
  const planet = "https://tiles.planet.com/data/v1/PSScene/abc/{z}/{x}/{y}.png?api_key=PLAK0123456789"
  const sh = "https://sh.dataspace.copernicus.eu/ogc/wmts/0a1b2c3d-1111-2222-3333-444455556666?layer=TRUE"
  const maptiler = "https://api.maptiler.com/tiles/terrain-rgb/{z}/{x}/{y}.webp?key=SECRETKEY"
  const signed = "https://bucket.s3.amazonaws.com/dem.tif?X-Amz-Credential=AKIA/2026&X-Amz-Signature=deadbeef&versionId=3"
  const search = new URLSearchParams({ basemapSource: planet, basemapSourceB: sh, terrainSourceA: maptiler, terrainSourceB: signed, lat: "1" })
  const p = viewParams(search)
  assert.equal(p.basemapSource, "https://tiles.planet.com/data/v1/PSScene/abc/{z}/{x}/{y}.png?api_key={planetKey}")
  assert.equal(p.basemapSourceB, "https://sh.dataspace.copernicus.eu/ogc/wmts/{shInstance}?layer=TRUE")
  assert.equal(p.terrainSourceA, "https://api.maptiler.com/tiles/terrain-rgb/{z}/{x}/{y}.webp?key={key}")
  assert.equal(p.terrainSourceB, "https://bucket.s3.amazonaws.com/dem.tif?X-Amz-Credential={key}&X-Amz-Signature={key}&versionId=3")
  const json = JSON.stringify(buildViewRecord(search))
  for (const secret of ["PLAK0123456789", "0a1b2c3d-1111", "SECRETKEY", "AKIA", "deadbeef"]) assert.equal(json.includes(secret), false, secret)
  assert.deepEqual(maskedParamKeys(search).sort(), ["basemapSource", "basemapSourceB", "terrainSourceA", "terrainSourceB"])
})

test("the same inside a percent-encoded address (sourceNames, sourceMeta)", () => {
  const u = "https://api.maptiler.com/tiles/x/{z}/{x}/{y}.png?key=SECRETKEY&v=2"
  const names = `${encodeURIComponent(u)}=${encodeURIComponent("My tiles")},${encodeURIComponent("https://a.example/t.tif")}=Plain`
  const masked = maskSecretsInValue(names)
  assert.equal(masked.includes("SECRETKEY"), false)
  assert.equal(masked, `${encodeURIComponent("https://api.maptiler.com/tiles/x/{z}/{x}/{y}.png?key=")}%7Bkey%7D${encodeURIComponent("&v=2")}=${encodeURIComponent("My tiles")},${encodeURIComponent("https://a.example/t.tif")}=Plain`)
})

test("a value with no credential is left exactly as it is", () => {
  for (const v of ["mapterhorn", "12.4", "https://tiles.example.com/{z}/{x}/{y}.png", "https://h.example/dem.tif?versionId=3&x=1", "a,b,c", "#ff0000"]) {
    assert.equal(maskSecretsInValue(v), v)
  }
  assert.deepEqual(maskedParamKeys("?lat=1&terrainSourceA=https://h.example/dem.tif"), [])
})

test("a repeated key is kept as a list and comes back repeated", () => {
  const p = viewParams("?drawingUrl=a&drawingUrl=b&lat=1")
  assert.deepEqual(p, { drawingUrl: ["a", "b"], lat: "1" })
  assert.equal(viewRecordToSearch({ params: p }).toString(), "drawingUrl=a&drawingUrl=b&lat=1")
})

test("record → address: the parameters, on the page's own origin and path, the pointer gone", () => {
  const record = buildViewRecord("?zoom=12.4&lat=45.8326&terrainSourceA=mapterhorn")
  assert.equal(expandedViewUrl(`https://terrain-viewer.iconem.com/?view=at/${DID}/abc&lat=0#frag`, record), "https://terrain-viewer.iconem.com/?zoom=12.4&lat=45.8326&terrainSourceA=mapterhorn")
  assert.equal(expandedViewUrl("http://127.0.0.1:5175/?view=at/x.example/abc", { params: {} }), "http://127.0.0.1:5175/")
})

test("record → address: the legacy key migration runs, as on any link", () => {
  const rename = (p: URLSearchParams) => { if (p.has("sourceA")) { p.set("terrainSourceA", p.get("sourceA")!); p.delete("sourceA") } }
  assert.equal(expandedViewUrl("https://x.example/", { params: { sourceA: "mapterhorn" } }, rename), "https://x.example/?terrainSourceA=mapterhorn")
})

// ── the read path ────────────────────────────────────────────────────────

type Reply = { status?: number; body?: unknown; throws?: boolean }
function stubFetch(routes: Record<string, Reply>, seen: string[] = []) {
  return (async (input: any) => {
    const url = String(input)
    seen.push(url)
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    const r = key ? routes[key] : { throws: true }
    if (r.throws) throw new TypeError("fetch failed")
    return new Response(JSON.stringify(r.body ?? null), { status: r.status ?? 200, headers: { "content-type": "application/json" } })
  }) as typeof fetch
}
const PLC = `https://plc.directory/${DID}`
const GET_RECORD = `${fixture.pds}/xrpc/com.atproto.repo.getRecord`
const ref = { repo: DID, rkey: "3m7abcdefgh2k" }

test("a view is read in two requests, with no credentials: the PLC directory, then the PDS", async () => {
  const seen: string[] = []
  const view = await loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { body: fixture.getRecord } }, seen) })
  assert.deepEqual(seen, [PLC, `${GET_RECORD}?repo=${encodeURIComponent(DID)}&collection=com.iconem.terrainviewer.view&rkey=3m7abcdefgh2k`])
  assert.equal(view.did, DID)
  assert.equal(view.pds, fixture.pds)
  assert.equal(view.record.title, "Mont Blanc, slope over hillshade")
  assert.equal(view.thumbnailUrl, blobUrl(fixture.pds, DID, "bafkreihwihm6kpd6zuwhhlro75p5qks5qtrcu55jp3gddbfjsieiv7wuka"))
  // A credential-named parameter in somebody's record is not applied.
  const url = expandedViewUrl("https://terrain-viewer.iconem.com/?view=x", view.record)
  assert.equal(url, "https://terrain-viewer.iconem.com/?zoom=12.4&lat=45.8326&lng=6.8652&pitch=60&sourceA=mapterhorn&showSlope=true")
})

test("a handle is resolved first (Bluesky's public API), then the same path", async () => {
  const seen: string[] = []
  const view = await loadView({ repo: "bsky.app", rkey: "3m7abcdefgh2k" }, { fetch: stubFetch({
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=bsky.app": { body: fixture.resolveHandle },
    [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { body: fixture.getRecord },
  }, seen) })
  assert.equal(view.did, DID)
  assert.equal(seen.length, 3)
})

test("a handle falls back to DNS-over-HTTPS when the public API does not answer", async () => {
  const view = await loadView({ repo: "bsky.app", rkey: "3m7abcdefgh2k" }, { fetch: stubFetch({
    "https://cloudflare-dns.com/dns-query?name=_atproto.bsky.app&type=TXT": { body: fixture.doh },
    [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { body: fixture.getRecord },
  }) })
  assert.equal(view.did, DID)
})

const fails = async (p: Promise<unknown>, kind: string, words: RegExp) => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ViewLoadError, String(e))
    assert.equal(e.kind, kind)
    assert.match(e.message, words)
    return true
  })
}

test("an unknown handle says so", async () => {
  await fails(loadView({ repo: "nobody.example.com", rkey: "abc" }, { fetch: stubFetch({
    "https://public.api.bsky.app/": fixture.resolveHandleNotFound, "https://cloudflare-dns.com/": { body: { Status: 3 } },
  }) }), "identity", /nobody\.example\.com.*could not be found/)
})

test("a deleted record says the view no longer exists", async () => {
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: fixture.recordNotFound }) }), "not-found", /no longer exists/)
})

test("an unreachable PDS is named, and told apart from a deleted record", async () => {
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { throws: true } }) }), "pds-unreachable", /puffball\.us-east\.host\.bsky\.network.*did not answer/)
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { status: 502, body: null } }) }), "pds-unreachable", /answered with an error \(502\)/)
})

test("an unregistered DID, an unreachable directory, a document with no PDS", async () => {
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: fixture.plcNotFound }) }), "identity", /does not exist/)
  await fails(loadView(ref, { fetch: stubFetch({}) }), "identity", /plc\.directory/)
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: { ...fixture.plcDocument, service: [] } } }) }), "identity", /names no data server/)
  // A document naming a non-https or path-carrying endpoint is not followed.
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: { ...fixture.plcDocument, service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "http://10.0.0.1/x" }] } } }) }), "identity", /names no data server/)
})

test("did:web is read from the host's own /.well-known/did.json", async () => {
  const seen: string[] = []
  const doc = { ...fixture.plcDocument, id: "did:web:pds.example.com" }
  const record = { ...fixture.getRecord, uri: "at://did:web:pds.example.com/com.iconem.terrainviewer.view/abc" }
  await loadView({ repo: "did:web:pds.example.com", rkey: "abc" }, { fetch: stubFetch({ "https://pds.example.com/.well-known/did.json": { body: doc }, [GET_RECORD]: { body: record } }, seen) })
  assert.equal(seen[0], "https://pds.example.com/.well-known/did.json")
})

test("a record of another shape, or of a newer schema, is refused with its own words", async () => {
  const other = { ...fixture.getRecord, value: { $type: "app.bsky.feed.post", text: "hello" } }
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { body: other } }) }), "invalid-record", /not a Terrain Viewer view/)
  const badParams = { ...fixture.getRecord, value: { ...fixture.getRecord.value, params: { lat: 45.8 } } }
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { body: badParams } }) }), "invalid-record", /not a Terrain Viewer view/)
  const newer = { ...fixture.getRecord, value: { ...fixture.getRecord.value, schemaVersion: 2 } }
  await fails(loadView(ref, { fetch: stubFetch({ [PLC]: { body: fixture.plcDocument }, [GET_RECORD]: { body: newer } }) }), "newer-schema", /newer version/)
})

// ── the OAuth client's identity ──────────────────────────────────────────

test("each deployed host is its own client: the id is the address of its own metadata file", () => {
  for (const host of OAUTH_CLIENT_HOSTS) {
    const c = oauthClientConfig({ protocol: "https:", hostname: host, port: "" })
    assert.deepEqual(c, { ok: true, kind: "web", client_id: `https://${host}/atproto/${host}.json`, redirect_uri: `https://${host}/` })
    // The file the site serves is the one the code describes.
    const file = JSON.parse(readFileSync(`public/atproto/${host}.json`, "utf8"))
    assert.deepEqual(file, oauthClientMetadata(host))
    assert.equal(file.client_id, `https://${host}/atproto/${host}.json`)
    assert.equal(file.token_endpoint_auth_method, "none")
    assert.equal(file.dpop_bound_access_tokens, true)
    assert.equal(file.scope, OAUTH_SCOPE)
    for (const r of file.redirect_uris as string[]) assert.equal(new URL(r).origin, new URL(file.client_id).origin)
  }
})

test("development is the loopback client: http://localhost as the id, 127.0.0.1 as the redirect", () => {
  const c = oauthClientConfig({ protocol: "http:", hostname: "127.0.0.1", port: "5175" })
  assert.ok(c.ok && c.kind === "loopback")
  const id = new URL(c.client_id)
  assert.equal(id.origin, "http://localhost")
  assert.equal(id.pathname, "/")
  assert.equal(id.searchParams.get("redirect_uri"), "http://127.0.0.1:5175/")
  assert.equal(id.searchParams.get("scope"), OAUTH_SCOPE)
  assert.equal(c.redirect_uri, "http://127.0.0.1:5175/")
})

test("localhost and unknown hosts cannot sign in, and say what to do", () => {
  const l = oauthClientConfig({ protocol: "http:", hostname: "localhost", port: "5175", pathname: "/", search: "?lat=1" })
  assert.ok(!l.ok && l.reason.includes("http://127.0.0.1:5175/?lat=1"))
  const o = oauthClientConfig({ protocol: "https:", hostname: "example.github.io", port: "" })
  assert.ok(!o.ok && /terrain-viewer\.iconem\.com/.test(o.reason))
})

test("the scope asks for this collection and pictures, nothing of the account's posts", () => {
  assert.equal(OAUTH_SCOPE, "atproto repo:com.iconem.terrainviewer.view blob:image/*")
})

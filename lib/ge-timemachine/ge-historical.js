/*
 * ge-historical.js — Google Earth "Time Machine" historical imagery for MapLibre.
 *
 * Decrypt: byte-wise GE XOR (./ge-decrypt.js, matches GEHistoricalImagery);
 * varint/protobuf decode uses protobufjs, zlib uses pako (both bundled by esbuild).
 *
 * Added here (the bits Cesium lacks): the db=tm endpoints, the protobuf
 * QuadtreePacket decoder that reads the IMAGERY_HISTORY dates layer, the Keyhole
 * sub-index math, JPEG-comment date unpacking + nearest-date selection, the
 * WGS84-square -> WebMercator vertical reprojection, and the MapLibre protocol.
 *
 * No chained ("proche en proche") retrieval: every capture date for a tile is
 * present in that tile's single decoded quadtree packet.
 */

import geDecrypt from "./ge-decrypt.js";
import * as _pb from "protobufjs";
import * as pako from "pako";

const protobuf = _pb.parse ? _pb : _pb.default || _pb;

// Schema faithful to GEHistoricalImagery's generated Quadtreeset/Dbroot protos.
// We decode with protobufjs (like GEHI's generated parser) rather than hand-
// walking the wire format, so real packets can't trip an edge case.
const PROTO_SRC = `
syntax = "proto2";
message EncryptedDbRootProto { optional int32 encryption_type = 1; optional bytes encryption_data = 2; optional bytes dbroot_data = 3; }
message DatabaseVersionProto { optional uint32 quadtree_version = 1; }
message StringIdOrValueProto { optional fixed32 string_id = 1; optional string value = 2; }
message ProviderInfoProto { optional int32 provider_id = 1; optional StringIdOrValueProto copyright_string = 2; optional int32 vertical_pixel_offset = 3; }
message StringEntryProto { optional fixed32 string_id = 1; optional string string_value = 2; }
message DbRootProto {
  optional DatabaseVersionProto database_version = 13;
  // provider_info/translation_entry field numbers per Open GEE's own
  // dbroot_v2.proto (google/earthenterprise) — a real per-provider
  // attribution table shipped inside the SAME dbRoot response already
  // fetched for quadtree_version above, no extra request needed. Confirmed
  // against CesiumJS's GoogleEarthEnterpriseMetadata (its requestDbRoot
  // builds a providerId → Credit(copyrightString) map from this exact field).
  repeated ProviderInfoProto provider_info = 3;
  repeated StringEntryProto translation_entry = 8;
}
message EarthImageryPacket { optional int32 image_type = 1; optional bytes image_data = 2; optional int32 alpha_type = 3; }
message QuadtreeImageryDatedTile { optional int32 date = 1; optional int32 dated_tile_epoch = 2; optional int32 provider = 3; }
message QuadtreeImageryDates { repeated QuadtreeImageryDatedTile dated_tile = 1; optional int32 shared_tile_date = 2; repeated int32 coarse_tile_dates = 3; optional int64 shared_tile_milliseconds = 4; }
message QuadtreeLayer { optional int32 type = 1; optional int32 layer_epoch = 2; optional int32 provider = 3; optional QuadtreeImageryDates dates_layer = 4; }
message QuadtreeChannel { optional int32 type = 1; optional int32 channel_epoch = 2; }
message QuadtreeNode { optional int32 flags = 1; optional int32 cache_node_epoch = 2; repeated QuadtreeLayer layer = 3; repeated QuadtreeChannel channel = 4; }
`;
// NOTE: QuadtreePacket itself is hand-parsed (not in this schema). Its
// sparse_quadtree_node (field 2) is a proto2 *group* — wire types 3/4, tags
// 19/20 (FieldCodec.ForGroup(19,20) in GEHI's generated proto). protobuf.js
// treats the `group` keyword as a length-delimited message, so it can't decode
// the real group framing; we walk it by hand in parseQuadtreePacket() and decode
// each inner QuadtreeNode (a normal message) with protobuf.js. Everything nested
// below QuadtreeNode is a regular message (ForGroup appears only here).
const _root = protobuf.parse(PROTO_SRC).root;
const Reader = protobuf.Reader;
const T_EncryptedDbRoot = _root.lookupType("EncryptedDbRootProto");
const T_DbRoot = _root.lookupType("DbRootProto");
const T_QuadtreeNode = _root.lookupType("QuadtreeNode");
const T_EarthImagery = _root.lookupType("EarthImageryPacket");

// --- endpoints (Time Machine / public historical) ---
const TM_HOST = "https://khmdb.google.com";
const KH_HOST = "https://kh.google.com";
const DBROOT_URL = `${TM_HOST}/dbRoot.v5?db=tm&hl=en&gl=us&output=proto`;

const MIN_JPEG_DATE = 545;
const COMPRESS_MAGIC = 0x7468dead;
const COMPRESS_MAGIC_SWAP = 0xadde6874;
const TILE_PX = 256;
const LAYER_TYPE = { IMAGERY: 0, TERRAIN: 1, VECTOR: 2, IMAGERY_HISTORY: 3 };


// =========================================================================
// Keyhole quadtree path math (ported from LibGoogleEarth / GEHI's KeyholeTile)
// =========================================================================
// This is the same GEE quadkey Cesium computes in
// GoogleEarthEnterpriseMetadata.tileXYToQuadKey(x, y, level): digit |= 2 for the
// top row, then |= 1 alternating by column. We keep this ~6-line port (verified
// identical to GEHI over 4000 cases, and round-tripped by decodePath) rather than
// depend on Cesium — Cesium's version is tied to its own y-axis orientation and
// omits the leading "0" root, and pulling all of CesiumJS for one tiny function
// isn't worth it. (We *do* reuse Cesium's XOR keystream and protobuf.js, where the
// logic is substantial.)
export function rowColToPath(row, col, level) {
  const chars = new Array(level + 1);
  let r = row >>> 0, c = col >>> 0;
  for (let i = level; i >= 0; i--) {
    const rb = r & 1, cb = c & 1;
    r >>>= 1; c >>>= 1;
    chars[i] = String.fromCharCode((rb << 1) | (rb ^ cb) | 0x30);
  }
  return chars.join("");
}
/** Inverse of rowColToPath: quadtree path -> {row, col, level}. */
export function decodePath(path) {
  let row = 0, col = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path.charCodeAt(i) & 3;
    const r = cell >> 1;
    const c = r ^ (cell & 1);
    row = (row << 1) | r;
    col = (col << 1) | c;
  }
  return { row, col, level: path.length - 1 };
}
function getRootSubIndex(p) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s = s * 4 + (p.charCodeAt(i) - 0x30 + 1);
  return s;
}
function getTreeSubIndex(p) {
  return getRootSubIndex(p) + (p.charCodeAt(0) - 0x30) * 85 + 1;
}
function subIndex(path) {
  if (path.length <= 4) return getRootSubIndex(path);
  return getTreeSubIndex(path.slice(Math.floor((path.length - 1) / 4) * 4));
}
function navPrefixes(path) {
  const out = [];
  for (let end = 4; end < path.length; end += 4) out.push(path.slice(0, end));
  return out;
}

/** Web-Mercator tile center -> the Keyhole (WGS84-square) tile path at the same level. */
export function keyholePathAtLngLat(lng, lat, level) {
  const n = 1 << level;
  const col = Math.max(0, Math.min(n - 1, Math.floor(((lng + 180) / 360) * n)));
  const row = Math.max(0, Math.min(n - 1, Math.floor(((lat + 180) / 360) * n)));
  return { row, col, level, path: rowColToPath(row, col, level) };
}

// =========================================================================
// Dates (JPEG-comment packed date)
// =========================================================================
function unpackDate(packed) {
  return { packed, year: packed >> 9, month: (packed >> 5) & 0xf, day: packed & 0x1f };
}
export function dayNumber(d) {
  return Math.floor(Date.UTC(d.year, Math.max(0, (d.month || 1) - 1), Math.max(1, d.day || 1)) / 86400000);
}
function dateKey(d) {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

// =========================================================================
// Decompression + protobuf decoders
// =========================================================================
function uncompress(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint32(0, true);
  if (magic !== COMPRESS_MAGIC && magic !== COMPRESS_MAGIC_SWAP)
    throw new Error("ge: bad compression magic");
  const size = dv.getUint32(4, magic === COMPRESS_MAGIC);
  const inflated = pako.inflate(new Uint8Array(arrayBuffer, 8));
  if (inflated.length !== size) throw new Error("ge: inflated size mismatch");
  return inflated;
}

function parseEncryptedDbRoot(u8) {
  const m = T_EncryptedDbRoot.decode(u8);
  return { encryptionData: m.encryptionData, dbrootData: m.dbrootData };
}
/** Resolves a StringIdOrValueProto to actual text — most dbRoots we've seen
 *  populate `value` inline (matching CesiumJS's own usage, which reads
 *  `.value` directly with no string_id lookup), but the schema allows an
 *  indexed reference into dbRoot's own translation_entry table instead, so
 *  fall back to that when `value` is empty. */
function resolveStringIdOrValue(s, translations) {
  if (!s) return undefined
  if (s.value) return s.value
  if (s.stringId) return translations.get(s.stringId)
  return undefined
}

function parseDbRoot(u8) {
  const m = T_DbRoot.decode(u8)
  const translations = new Map()
  for (const entry of m.translationEntry || []) {
    if (entry.stringId != null) translations.set(entry.stringId, entry.stringValue)
  }
  // providerId → real copyright string (e.g. "DigitalGlobe", "Aerometrex",
  // "CNES/Airbus" — whatever Google's own dbRoot currently lists), keyed by
  // the same integer each QuadtreeImageryDatedTile/QuadtreeLayer's own
  // `provider` field references (see parseQuadtreePacket below).
  const providers = new Map()
  for (const p of m.providerInfo || []) {
    const copyright = resolveStringIdOrValue(p.copyrightString, translations)
    if (p.providerId != null && copyright) providers.set(p.providerId, copyright)
  }
  return { quadtreeVersion: m.databaseVersion?.quadtreeVersion ?? 1, providers }
}
function parseQuadtreePacket(u8) {
  // QuadtreePacket { 1: packet_epoch (varint); 2: repeated GROUP sparse_quadtree_node }
  // The group body is SparseQuadtreeNode { 3: index (varint); 4: node (QuadtreeNode message) },
  // framed by start-group (tag 19) … end-group (tag 20). protobuf.js can't do real
  // groups, so we walk the wire format here and hand each node to protobuf.js.
  const r = Reader.create(u8);
  const nodes = new Map();
  while (r.pos < r.len) {
    const tag = r.uint32(), f = tag >>> 3, w = tag & 7;
    if (f === 2 && w === 3) {                 // start group → one SparseQuadtreeNode
      let index = 0, node = null;
      while (r.pos < r.len) {
        const t2 = r.uint32(), f2 = t2 >>> 3, w2 = t2 & 7;
        if (w2 === 4) break;                  // end group
        if (f2 === 3 && w2 === 0) index = r.uint32();
        else if (f2 === 4 && w2 === 2) {      // node = QuadtreeNode (length-delimited message)
          const len = r.uint32(), end = r.pos + len;
          node = T_QuadtreeNode.decode(u8.subarray(r.pos, end));
          r.pos = end;
        } else r.skipType(w2);
      }
      if (node) nodes.set(index | 0, node);
    } else r.skipType(w);
  }
  return { nodes };
}

function sniffImageType(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46) return "image/jpeg";
  if (b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return undefined;
}
function decodeImageryProto(u8) {
  try {
    const m = T_EarthImagery.decode(u8);
    if (m.imageData && m.imageData.length)
      return { data: m.imageData, type: m.imageType === 4 ? "image/png" : "image/jpeg" };
  } catch { /* not an imagery packet */ }
  return null;
}

const mercYNormToLat = (yNorm) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * yNorm))) * 180) / Math.PI;

// =========================================================================
// Source
// =========================================================================
export class GEHistoricalSource {
  constructor(opts = {}) {
    this.proxyUrl = opts.proxyUrl || "";
    // Optional headers sent to the proxy (e.g. an auth key it requires). Empty
    // proxyUrl ("direct" mode) means we fetch Google directly — only works behind
    // a CORS-allowing browser extension or a server that injects CORS headers.
    this.proxyHeaders = opts.proxyHeaders || null;
    this.maxLevel = opts.maxLevel ?? 23;
    this.targetDate = opts.date || null;
    this.debug = !!opts.debug;
    this.key = null;
    this.rootEpoch = 1;
    this.providers = new Map(); // providerId -> real copyright string, from dbRoot (see parseDbRoot)
    this._packetCache = new Map();
    this._packetInflight = new Map();
    this._dateCache = new Map();
    this._dateInflight = new Map();    // path -> Promise (dedupe concurrent date walks)
    this._jpegCache = new Map();       // path@epoch@packed -> decoded image bytes+type (LRU-ish)
    this._jpegInflight = new Map();    // same key -> Promise (dedupe concurrent tile fetches)
    this._jpegCacheMax = opts.jpegCacheMax ?? 400;
    this._tileCache = new Map();       // key z/x/y@date -> PNG Uint8Array (LRU-ish)
    this._tileInflight = new Map();    // key -> Promise (dedupe concurrent requests)
    this._tileCacheMax = opts.tileCacheMax ?? 700;
    this._readyPromise = null;
  }
  _curDateKey() {
    const t = this.targetDate;
    if (!t) return "newest";
    const d = t instanceof Date ? { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() } : t;
    return dateKey(d);
  }
  _proxied(url) { return this.proxyUrl ? this.proxyUrl + encodeURIComponent(url) : url; }

  /** Change transport at runtime and drop everything fetched under the old one,
   *  so a failed direct/proxy load is retried cleanly under the new transport. */
  setProxy(proxyUrl, proxyHeaders) {
    this.proxyUrl = proxyUrl || "";
    this.proxyHeaders = proxyHeaders || null;
    this._readyPromise = null;          // re-run dbRoot load (it may have failed before)
    this.key = null;
    this.rootEpoch = 1;
    this.providers = new Map();
    for (const m of [this._packetCache, this._packetInflight, this._dateCache, this._dateInflight,
                     this._jpegCache, this._jpegInflight, this._tileCache, this._tileInflight]) m.clear();
  }

  _log(...a) { if (this.debug) console.log("[ge]", ...a); }

  async _fetchBuf(rawUrl, label, signal) {
    const init = {};
    if (signal) init.signal = signal;
    if (this.proxyHeaders) init.headers = this.proxyHeaders; // e.g. an auth key the proxy needs
    const res = await fetch(this._proxied(rawUrl), init);
    const buf = await res.arrayBuffer();
    if (this.debug) {
      const b = new Uint8Array(buf);
      const head = [...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
      this._log(label, res.status, `${buf.byteLength}B`, `head=${head}`, rawUrl.replace(/^https?:\/\/[^/]+/, ""));
    }
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    if (buf.byteLength === 0) throw new Error(`${label} empty body`);
    return buf;
  }

  ready() { return (this._readyPromise ||= this._loadDbRoot()); }

  async _loadDbRoot() {
    const buf = await this._fetchBuf(DBROOT_URL, "dbRoot");
    const { encryptionData, dbrootData } = parseEncryptedDbRoot(new Uint8Array(buf));
    if (!encryptionData || !dbrootData) throw new Error("ge: malformed dbRoot");
    this.key = encryptionData.slice().buffer;
    if (this.key.byteLength % 4 !== 0)
      throw new Error(`ge: key length ${this.key.byteLength} not multiple of 4`);
    const body = dbrootData.slice().buffer;
    geDecrypt(this.key, body);
    const { quadtreeVersion, providers } = parseDbRoot(uncompress(body));
    this.rootEpoch = quadtreeVersion || 1;
    this.providers = providers;
    this._log("dbRoot ok — keyLen", this.key.byteLength, "rootEpoch", this.rootEpoch, "providers", providers.size);
    return this;
  }

  async _getPacket(path, epoch) {
    const ck = `${path}@${epoch}`;
    if (this._packetCache.has(ck)) return this._packetCache.get(ck);
    if (this._packetInflight.has(ck)) return this._packetInflight.get(ck);
    const p = (async () => {
      const t0 = (globalThis.performance || Date).now();
      const buf = await this._fetchBuf(`${TM_HOST}/flatfile?db=tm&qp-${path}-q.${epoch}`, `packet ${path}`);
      geDecrypt(this.key, buf);
      const inflated = uncompress(buf);
      const packet = parseQuadtreePacket(inflated);
      this._packetCache.set(ck, packet);
      this._packetInflight.delete(ck);
      if (this.debug) {
        const withChild = [...packet.nodes].filter(([, n]) => n.cacheNodeEpoch);
        const sample = [...packet.nodes].slice(0, 12).map(([i, n]) => `${i}${n.cacheNodeEpoch ? "→p" + n.cacheNodeEpoch : ""}${(n.layer || []).length ? "L[" + (n.layer || []).map((l) => l.type ?? 0).join("") + "]" : ""}`).join(" ");
        const dt = Math.round(((globalThis.performance || Date).now() - t0));
        this._log(`packet ${path}@${epoch}: ${inflated.length}B inflated, ${packet.nodes.size} nodes (${withChild.length} w/child-epoch), ${dt}ms`);
        this._log(`  nodes: ${sample}${packet.nodes.size > 12 ? " …" : ""}`);
      }
      return packet;
    })();
    this._packetInflight.set(ck, p);
    return p;
  }

  async getNode(path) {
    await this.ready();
    if (this.debug) {
      const { row, col, level } = decodePath(path);
      this._log(`getNode quadkey="${path}" (L${level} row=${row} col=${col}) subIndex=${subIndex(path)} via prefixes [${navPrefixes(path).join(", ") || "(root only)"}]`);
    }
    let packet;
    try { packet = await this._getPacket("0", this.rootEpoch); } catch (e) { this._log("root packet error:", e.message); throw e; }
    for (const pre of navPrefixes(path)) {
      const si = subIndex(pre);
      const branch = packet.nodes.get(si);
      this._log(`  prefix "${pre}" subIndex=${si} → ${branch ? (branch.cacheNodeEpoch ? "child packet epoch " + branch.cacheNodeEpoch : "node present but NO cacheNodeEpoch (leaf here)") : "NO node at this subIndex"}`);
      if (!branch || !branch.cacheNodeEpoch) {
        this._log(`  ⇒ walk stops at "${pre}" — no deeper tm packet (sparse/edge of coverage)`);
        return null;
      }
      try { packet = await this._getPacket(pre, branch.cacheNodeEpoch); } catch (e) { this._log("child packet error:", e.message); throw e; }
      if (!packet) return null;
    }
    const node = packet.nodes.get(subIndex(path)) || null;
    this._log(`  ⇒ ${node ? `node found, ${(node.layer || []).length} layer(s) types=[${(node.layer || []).map((l) => l.type ?? 0).join(",")}] (3=IMAGERY_HISTORY)` : "leaf node missing at final subIndex"}`);
    return node;
  }

  /** All captures for a Keyhole tile path, newest first. Cached + de-duped so
   *  concurrent viewport tiles asking for the same path share one walk. */
  async getDatesForPath(path) {
    if (this._dateCache.has(path)) return this._dateCache.get(path);
    if (this._dateInflight.has(path)) return this._dateInflight.get(path);
    const job = this._computeDatesForPath(path).finally(() => this._dateInflight.delete(path));
    this._dateInflight.set(path, job);
    return job;
  }

  async _computeDatesForPath(path) {
    let node;
    try {
      node = await this.getNode(path);
    } catch (e) {
      // Transient fetch/parse/abort error — return empty but DON'T cache, so a
      // later request (e.g. the timeline analysis) can retry instead of seeing
      // a poisoned empty result.
      if (e?.name !== "AbortError") this._log(`getDatesForPath ${path}: walk error (not cached): ${e.message}`);
      return [];
    }
    let dated = [];
    if (node) {
      const layers = node.layer || [];
      const hist = layers.find((l) => (l.type ?? 0) === LAYER_TYPE.IMAGERY_HISTORY);
      const imagery = layers.find((l) => (l.type ?? 0) === LAYER_TYPE.IMAGERY);
      const histTiles = hist?.datesLayer?.datedTile;
      if (histTiles && histTiles.length) {
        for (const dt of histTiles) {
          const date = dt.date ?? 0;
          if (date <= MIN_JPEG_DATE) continue;
          const d = unpackDate(date);
          if (dt.provider) dated.push({ ...d, epoch: dt.datedTileEpoch ?? 0, provider: dt.provider, kind: "tm" });
          else if (imagery) dated.push({ ...d, epoch: imagery.layerEpoch ?? 0, provider: imagery.provider ?? 0, kind: "default" });
        }
      } else if (imagery) {
        // imagery.provider (QuadtreeLayer's own provider field, distinct
        // from each dated tile's) — previously discarded here in favor of a
        // hardcoded 0, even though the current/default imagery layer has
        // its own real provider just like every dated tile does.
        dated.push({ year: 0, month: 0, day: 0, packed: 0, epoch: imagery.layerEpoch ?? 0, provider: imagery.provider ?? 0, kind: "default" });
      }
    }
    dated.sort((a, b) => dayNumber(b) - dayNumber(a));
    if (this.debug) {
      const real = dated.filter((d) => d.packed);
      this._log(`dates ${path}: ${real.length} dated capture(s)${real.length ? " → " + real.map((d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`).join(", ") : (dated.length ? " (current imagery only, no history)" : " (none)")}`);
    }
    this._dateCache.set(path, dated);
    return dated;
  }

  /** Real copyright string for one of getDatesForPath's own `provider` ids
   *  (e.g. "DigitalGlobe", "CNES/Airbus" — whatever Google's dbRoot
   *  currently lists), or null if dbRoot hasn't loaded yet or lists no
   *  entry for that id (id 0 is the "no provider info" sentinel used
   *  throughout this file, never a real dbRoot id). */
  getProviderCopyright(providerId) {
    if (!providerId) return null
    return this.providers.get(providerId) ?? null
  }

  _pickDate(dated) {
    if (!dated.length) return null;
    if (!this.targetDate) return dated[0];
    const t = this.targetDate instanceof Date
      ? { year: this.targetDate.getUTCFullYear(), month: this.targetDate.getUTCMonth() + 1, day: this.targetDate.getUTCDate() }
      : this.targetDate;
    const tn = dayNumber(t);
    let best = dated[0], bestD = Math.abs(dayNumber(best) - tn);
    for (const d of dated) { const dd = Math.abs(dayNumber(d) - tn); if (dd < bestD) { bestD = dd; best = d; } }
    return best;
  }

  // Fetch+decrypt+decode one Keyhole image tile to raw image bytes, cached and
  // de-duped by (path,epoch,packed) — the same f1- tile is shared by several
  // Mercator output tiles, so without this it gets fetched many times.
  async _getTileImageBytes(path, chosen, signal) {
    const key = `${path}@${chosen.epoch}@${chosen.packed || 0}`;
    if (this._jpegCache.has(key)) return this._jpegCache.get(key);
    if (this._jpegInflight.has(key)) return this._jpegInflight.get(key);
    const job = (async () => {
      const url = chosen.kind === "tm" && chosen.packed
        ? `${TM_HOST}/flatfile?db=tm&f1-${path}-i.${chosen.epoch}-${chosen.packed.toString(16)}`
        : `${KH_HOST}/flatfile?f1-${path}-i.${chosen.epoch}`;
      const buf = await this._fetchBuf(url, `tile ${path}`, signal);
      geDecrypt(this.key, buf);
      let bytes = new Uint8Array(buf);
      let type = sniffImageType(bytes);
      if (!type) { const m = decodeImageryProto(bytes); if (m) { bytes = m.data; type = m.type; } }
      if (!type) {
        const head = [...bytes.slice(0, 6)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
        this._log(`tile ${path}: not an image after decode (head=${head}) — skipping`);
        return null;
      }
      const rec = { bytes, type };
      if (this._jpegCache.size >= this._jpegCacheMax) this._jpegCache.delete(this._jpegCache.keys().next().value);
      this._jpegCache.set(key, rec);
      return rec;
    })().catch((e) => { if (e?.name !== "AbortError") this._log("tile fetch failed:", e.message); return null; })
      .finally(() => this._jpegInflight.delete(key));
    this._jpegInflight.set(key, job);
    return job;
  }

  async _fetchTileBitmap(path, chosen, signal) {
    const rec = await this._getTileImageBytes(path, chosen, signal);
    if (!rec) return null;
    try {
      return await createImageBitmap(new Blob([rec.bytes], { type: rec.type }));
    } catch (e) {
      this._log(`tile ${path}: ${rec.type} failed to decode (${e.message})`);
      return null;
    }
  }

  /** Assemble one Web-Mercator z/x/y tile by reprojecting the covering Keyhole tiles. */
  async getMercatorTile(z, x, y, signal) {
    await this.ready();
    if (z < 1 || z > this.maxLevel) return null;
    const ck = `${z}/${x}/${y}@${this._curDateKey()}`;
    const hit = this._tileCache.get(ck);
    if (hit !== undefined) return hit ? hit.slice() : null;       // serve from cache (copy)
    if (this._tileInflight.has(ck)) { const r = await this._tileInflight.get(ck); return r ? r.slice() : null; }
    const job = this._buildMercatorTile(z, x, y, signal).then((res) => {
      if (signal?.aborted) return res;                            // don't cache aborted result
      if (this._tileCache.size >= this._tileCacheMax) this._tileCache.delete(this._tileCache.keys().next().value);
      this._tileCache.set(ck, res || null);
      return res;
    }).finally(() => this._tileInflight.delete(ck));
    this._tileInflight.set(ck, job);
    const res = await job;
    return res ? res.slice() : null;
  }

  async _buildMercatorTile(z, x, y, signal) {
    const n = 1 << z;
    const geCol = x; // longitude is linear & tile counts match
    const latN = mercYNormToLat(y / n);
    const latS = mercYNormToLat((y + 1) / n);
    const rowTop = Math.min(n - 1, Math.floor(((latN + 180) / 360) * n));
    const rowBot = Math.max(0, Math.floor(((latS + 180) / 360) * n));
    const numRows = rowTop - rowBot + 1;
    if (numRows < 1) return null;

    const strip = makeCanvas(TILE_PX, numRows * TILE_PX);
    const sctx = strip.getContext("2d");
    let drew = false;
    await Promise.all(
      Array.from({ length: numRows }, (_, k) => rowBot + k).map(async (row) => {
        const path = rowColToPath(row, geCol, z);
        const chosen = this._pickDate(await this.getDatesForPath(path));
        if (!chosen) return;
        const bmp = await this._fetchTileBitmap(path, chosen, signal).catch(() => null);
        if (!bmp) return;
        sctx.drawImage(bmp, 0, (rowTop - row) * TILE_PX);
        bmp.close?.();
        drew = true;
      }),
    );
    if (!drew) return null;

    // Resample the plate-carrée strip into the Web-Mercator tile. Latitude is
    // non-linear in Mercator, so a single linear stretch visibly drifts when a
    // tile spans a lot of latitude (i.e. when zoomed out). Remap in horizontal
    // bands instead: each band takes its true Mercator latitude range, so the
    // piecewise-linear fit hugs the real curve. No extra network — same strip.
    const stripTopLat = ((rowTop + 1) * 360) / n - 180;
    const latPerPx = 360 / n / TILE_PX;
    const out = makeCanvas(TILE_PX, TILE_PX);
    const octx = out.getContext("2d");
    const SEG = 32;
    for (let s = 0; s < SEG; s++) {
      const dyTop = (s / SEG) * TILE_PX;
      const dyBot = ((s + 1) / SEG) * TILE_PX;
      const latTop = mercYNormToLat((y + s / SEG) / n);
      const latBot = mercYNormToLat((y + (s + 1) / SEG) / n);
      const sy0 = (stripTopLat - latTop) / latPerPx;
      const sy1 = (stripTopLat - latBot) / latPerPx;
      octx.drawImage(strip, 0, sy0, TILE_PX, Math.max(1, sy1 - sy0), 0, dyTop, TILE_PX, dyBot - dyTop);
    }
    return canvasToPngBytes(out);
  }
}

// =========================================================================
// Canvas helpers
// =========================================================================
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h; return c;
}
async function canvasToPngBytes(canvas) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: "image/png" })
    : await new Promise((res) => canvas.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
// MapLibre's protocol image path does `new Blob([new Uint8Array(data)])`, so the
// returned `data` may be EITHER an ArrayBuffer or a Uint8Array — both decode fine.
// What matters: it must be *decodable image bytes*. Non-image bytes make
// createImageBitmap reject as "The source image could not be decoded" (v5 doesn't
// await it, so the rejection surfaces unwrapped). For a raster source, returning
// {data:null} hangs the tile, so empty tiles return a valid transparent PNG.

// 256x256 fully-transparent PNG (Uint8Array) for tiles with no GE imagery.
const TRANSPARENT_PNG = (() => {
  const b = atob("iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==");
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
})();
const emptyTile = () => TRANSPARENT_PNG.slice(); // fresh copy (MapLibre may transfer it)

// =========================================================================
// MapLibre integration
// =========================================================================
export function registerGEHistorical(maplibregl, opts = {}) {
  const scheme = opts.scheme || "gehist";
  const src = new GEHistoricalSource(opts);

  maplibregl.addProtocol(scheme, async (params, abortController) => {
    const m = new RegExp(`^${scheme}://(\\d+)/(\\d+)/(\\d+)`).exec(params.url);
    if (!m) return { data: emptyTile() };
    const z = +m[1], x = +m[2], y = +m[3];
    const q = params.url.split("?")[1] || "";
    const dm = /(?:^|&)d=(\d{4})-(\d{2})-(\d{2})/.exec(q);
    if (dm) src.targetDate = { year: +dm[1], month: +dm[2], day: +dm[3] };
    try {
      const data = await src.getMercatorTile(z, x, y, abortController?.signal);
      // Always hand MapLibre a Uint8Array PNG (never an ArrayBuffer / undecodable bytes).
      return { data: data || emptyTile() };
    } catch (e) {
      if (e?.name !== "AbortError" && opts.debug) console.warn("ge tile error", z, x, y, e);
      return { data: emptyTile() };
    }
  });

  let bustN = 0; // bumped to force MapLibre to refetch GE tiles after a transport change
  function tilesFor(date, bust) {
    let q = "";
    if (date) {
      const d = date instanceof Date
        ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
        : date;
      q = `?d=${dateKey(d)}`;
    }
    if (bust) q += (q ? "&" : "?") + `r=${bust}`; // ignored by the protocol regex; just busts the cache
    return [`${scheme}://{z}/{x}/{y}${q}`];
  }

  return {
    source: src,
    ready: () => src.ready(),
    keyholePathAtLngLat,
    getDatesForPath: (p) => src.getDatesForPath(p),
    getProviderCopyright: (id) => src.getProviderCopyright(id),
    makeRasterSource(date = opts.date) {
      return { type: "raster", tiles: tilesFor(date), tileSize: TILE_PX, minzoom: 1, maxzoom: opts.maxLevel ?? 23, attribution: "Imagery © Google" };
    },
    async setDate(map, sourceId, date) {
      const next = date instanceof Date
        ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
        : date;
      const prevKey = src._curDateKey();
      src.targetDate = next;
      if (src._curDateKey() === prevKey) return; // unchanged → don't refetch tiles
      const s = map.getSource(sourceId);
      if (s && s.setTiles) s.setTiles(tilesFor(next));
    },
    /** Switch transport at runtime: direct=true fetches Google directly (needs a
     *  CORS-allowing browser extension), else routes through the given proxy.
     *  Resets the source and forces the GE layer to refetch under the new transport. */
    setProxyMode(map, sourceId, { direct, proxyUrl, proxyHeaders } = {}) {
      src.setProxy(direct ? "" : (proxyUrl || ""), direct ? null : (proxyHeaders || null));
      const s = map.getSource(sourceId);
      if (s && s.setTiles) s.setTiles(tilesFor(src.targetDate, ++bustN));
    },
  };
}

/**
 * CameraUtilities.tsx
 *
 * State ownership:
 *   nuqs URL params (owned here via useQueryStates):
 *     animDuration, animLoopMode, animSmoothCamera, animPlaying, animPlaying360,
 *     animPose1 (absolute), animPose2Delta (relative to animPose1)
 *   Atoms with storage (persist across sessions):
 *     resolutionKeyAtom, renderQualityAtom, fpsAtom, targetSizeMBAtom
 *   Local state (component-only):
 *     progress (elapsed fraction), exporting, exportProgress, exportCodec
 *
 * RAF loops use module-level engines (RafEngine instances below) so they
 * survive sidebar close/reopen — the component just reads isRunning() on
 * mount and can stop via engine.stop(). Since `playing`/`spinning` live in
 * the URL (not component state), pause/stop works correctly even right after
 * the sidebar remounts.
 */

import { useRef, useState, useCallback, useEffect, useMemo, type RefObject } from "react"
import { useQueryStates, parseAsBoolean, parseAsString, parseAsFloat, createParser } from "nuqs"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { MapRef } from "react-map-gl/maplibre"
import { Play, Pause, Check, Video, Download } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Section } from "./controls-components"
import { atomWithStorage } from "jotai/utils"
import { useAtom } from "jotai"

// import { type AppSnapshot, type CameraPose, encodeSnapshot, decodeSnapshot } from "@/lib/pose-codec"
// import { animEngine, spinEngine, fovEngine } from "@/lib/animation-engine"

/**
 * animation-engine.ts
 *
 * Module-level RAF manager for keyframe & 360 spin animations.
 * Survives React component unmount/remount (sidebar close/reopen).
 *
 * Usage:
 *   import { animEngine, spinEngine } from '@/lib/animation-engine'
 *   animEngine.start(tickFn)   // starts RAF loop calling tickFn
 *   animEngine.stop()          // cancels RAF
 *   animEngine.isRunning()     // check status
 */






/**
 * pose-codec.ts
 *
 * Compact base64 encode/decode of AppSnapshot for URL storage.
 * A pose has 8 floats (lat, lng, zoom, pitch, bearing, roll, vfov, refWidth)
 * plus a variable-size numericState map.
 *
 * Binary format:
 *   [8 x float64]  — CameraPose fields in fixed order
 *   [uint16]        — number of numeric state entries
 *   For each entry:
 *     [uint8]       — key length
 *     [utf8 bytes]  — key
 *     [float64]     — value
 *
 * Then base64url-encoded (URL-safe, no padding).
 */

export interface CameraPose {
  lat: number
  lng: number
  zoom: number
  pitch: number
  bearing: number
  roll: number
  vfov: number
  refWidth: number
}

export interface AppSnapshot {
  pose: CameraPose
  numericState: Record<string, number>
}

const POSE_KEYS: (keyof CameraPose)[] = [
  "lat", "lng", "zoom", "pitch", "bearing", "roll", "vfov", "refWidth",
]

// ─── Encode ─────────────────────────────────────────────────────────────────────

export function encodeSnapshot(snap: AppSnapshot): string {
  const entries = Object.entries(snap.numericState)
  const encoder = new TextEncoder()

  // Calculate total byte size
  let size = POSE_KEYS.length * 8 + 2 // 8 floats + entry count
  for (const [key] of entries) {
    size += 1 + encoder.encode(key).byteLength + 8 // keyLen + key + float64
  }

  const buf = new ArrayBuffer(size)
  const view = new DataView(buf)
  let offset = 0

  // Write pose floats
  for (const k of POSE_KEYS) {
    view.setFloat64(offset, snap.pose[k], true)
    offset += 8
  }

  // Write numeric state
  view.setUint16(offset, entries.length, true)
  offset += 2

  for (const [key, val] of entries) {
    const keyBytes = encoder.encode(key)
    view.setUint8(offset, keyBytes.byteLength)
    offset += 1
    new Uint8Array(buf, offset, keyBytes.byteLength).set(keyBytes)
    offset += keyBytes.byteLength
    view.setFloat64(offset, val, true)
    offset += 8
  }

  return uint8ToBase64Url(new Uint8Array(buf))
}

// ─── Decode ─────────────────────────────────────────────────────────────────────

export function decodeSnapshot(encoded: string): AppSnapshot | null {
  try {
    const bytes = base64UrlToUint8(encoded)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const decoder = new TextDecoder()
    let offset = 0

    const pose = {} as CameraPose
    for (const k of POSE_KEYS) {
      ;(pose as any)[k] = view.getFloat64(offset, true)
      offset += 8
    }

    const numEntries = view.getUint16(offset, true)
    offset += 2

    const numericState: Record<string, number> = {}
    for (let i = 0; i < numEntries; i++) {
      const keyLen = view.getUint8(offset)
      offset += 1
      const key = decoder.decode(bytes.slice(offset, offset + keyLen))
      offset += keyLen
      numericState[key] = view.getFloat64(offset, true)
      offset += 8
    }

    return { pose, numericState }
  } catch {
    return null
  }
}

// ─── Delta helpers ──────────────────────────────────────────────────────────
// pose2 is stored in the URL as a delta from pose1 rather than an absolute
// snapshot — deltas are small numbers so there's no need for a fancier
// compressed encoding, but we still run them through the same compact binary
// codec above since it already handles the numericState map generically.

function subtractSnapshots(a: AppSnapshot, b: AppSnapshot): AppSnapshot {
  const pose = {} as CameraPose
  for (const k of POSE_KEYS) pose[k] = a.pose[k] - b.pose[k]
  const numericState: Record<string, number> = {}
  for (const k of Object.keys(a.numericState)) numericState[k] = a.numericState[k] - (b.numericState[k] ?? 0)
  return { pose, numericState }
}

function addSnapshots(a: AppSnapshot, delta: AppSnapshot): AppSnapshot {
  const pose = {} as CameraPose
  for (const k of POSE_KEYS) pose[k] = a.pose[k] + delta.pose[k]
  const numericState: Record<string, number> = {}
  for (const k of Object.keys(delta.numericState)) numericState[k] = (a.numericState[k] ?? 0) + delta.numericState[k]
  return { pose, numericState }
}

// ─── Base64url helpers (no padding, URL-safe) ────────────────────────────────

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlToUint8(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ─── nuqs parser for poses ──────────────────────────────────────────────────────

/**
 * Usage with nuqs:
 *   import { createParser } from 'nuqs'
 *   export const parseAsSnapshot = createParser({
 *     parse: (v) => decodeSnapshot(v),
 *     serialize: (v) => encodeSnapshot(v),
 *   })
 */




type TickFn = (now: number) => boolean // return false to stop

class RafEngine {
  private rafId: number | null = null
  private tickFn: TickFn | null = null

  start(tick: TickFn) {
    this.stop()
    this.tickFn = tick
    const loop = (now: number) => {
      if (!this.tickFn) return
      const cont = this.tickFn(now)
      if (cont) {
        this.rafId = requestAnimationFrame(loop)
      } else {
        this.rafId = null
        this.tickFn = null
      }
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.tickFn = null
  }

  isRunning() {
    return this.rafId !== null
  }
}

/** Keyframe animation (pose1 → pose2) RAF engine */
export const animEngine = new RafEngine()

/** 360° spin RAF engine */
export const spinEngine = new RafEngine()

/** FOV animation RAF engine */
export const fovEngine = new RafEngine()








// Re-export for external use
export type { AppSnapshot, CameraPose }

// ─── nuqs custom parser for poses ─────────────────────────────────────────────

const parseAsSnapshot = createParser({
  parse: (v: string) => decodeSnapshot(v),
  serialize: (v: AppSnapshot) => encodeSnapshot(v),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type LoopMode = "none" | "forward" | "bounce"
type RenderQuality = "quick" | "normal" | "hq"

interface ExportResolution {
  label: string; width: number; height: number
}

const EXPORT_RESOLUTIONS: ExportResolution[] = [
  { label: "Quick 360p 16:9",  width: 640,  height: 360 },
  { label: "720p 16:9",        width: 1280, height: 720 },
  { label: "1080p FHD 16:9",   width: 1920, height: 1080 },
  { label: "4K UHD 16:9",      width: 3840, height: 2160 },
  { label: "Native",           width: 0,    height: 0 },
  { label: "1080×1080 1:1",    width: 1080, height: 1080 },
  { label: "2048×2048 1:1",    width: 2048, height: 2048 },
]

const RENDER_QUALITY_OPTIONS: { value: RenderQuality; label: string; extraFrames: number }[] = [
  { value: "quick",  label: "Quick (0 extra frames)",  extraFrames: 0 },
  { value: "normal", label: "Normal (2 extra frames)", extraFrames: 2 },
  { value: "hq",     label: "HQ (10 extra frames)",    extraFrames: 10 },
]

// ─── Persistent Atoms (Export Settings) ───────────────────────────────────────

export const resolutionKeyAtom = atomWithStorage("anim-resolution-key", "1080p FHD 16:9")
export const renderQualityAtom = atomWithStorage<RenderQuality>("anim-render-quality", "normal")
export const fpsAtom = atomWithStorage("anim-fps", 60)
export const targetSizeMBAtom = atomWithStorage("anim-target-size-mb", "")

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const getMap = (ref: React.RefObject<MapRef>) => ref.current?.getMap() ?? null
const smoothstep   = (t: number) => t * t * (3 - 2 * t)
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp         = (a: number, b: number, t: number) => a + (b - a) * t
const lerpAngle    = (a: number, b: number, t: number) => {
  const d = ((b - a + 540) % 360) - 180; return a + d * t
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function extractNumbers(obj: Record<string, unknown>, prefix = ""): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    const val = obj[key]
    if (typeof val === "number") out[path] = val
    else if (val && typeof val === "object" && !Array.isArray(val))
      Object.assign(out, extractNumbers(val as Record<string, unknown>, path))
  }
  return out
}

function applyNumbers(obj: Record<string, unknown>, nums: Record<string, number>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  for (const [path, val] of Object.entries(nums)) {
    const parts = path.split(".")
    let node: any = clone
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]]
    node[parts[parts.length - 1]] = val
  }
  return clone
}

function lerpNumericMaps(a: Record<string, number>, b: Record<string, number>, t: number) {
  const out: Record<string, number> = {}
  for (const k of Object.keys(a)) out[k] = k in b ? lerp(a[k], b[k], t) : a[k]
  return out
}

/**
 * Apply a raw [0..1] progress value to the map + optional appState.
 */
function applyProgress(
  raw: number,
  p1: AppSnapshot, p2: AppSnapshot,
  map: ReturnType<typeof getMap>,
  appState: Record<string, unknown> | undefined,
  onAppStateChange: ((s: Record<string, unknown>, shallow?: boolean) => void) | undefined,
  shallow?: boolean
) {
  if (!map) return
  const t = smootherstep(clamp(raw, 0, 1))

  map.easeTo({
    center: [lerp(p1.pose.lng, p2.pose.lng, t), lerp(p1.pose.lat, p2.pose.lat, t)],
    zoom:   lerp(p1.pose.zoom, p2.pose.zoom, t),
    pitch:  lerp(p1.pose.pitch, p2.pose.pitch, t),
    bearing: lerpAngle(p1.pose.bearing, p2.pose.bearing, t),
    duration: 0,
    animate: false,
  })
  ;(map as any).setRoll?.(lerp(p1.pose.roll, p2.pose.roll, t))
  map.setVerticalFieldOfView(lerp(p1.pose.vfov, p2.pose.vfov, t))
  map.triggerRepaint()

  if (appState && onAppStateChange &&
      Object.keys(p1.numericState).length > 0 &&
      Object.keys(p2.numericState).length > 0) {
    onAppStateChange(applyNumbers(appState, lerpNumericMaps(p1.numericState, p2.numericState, t)), shallow)
  }
}

// ─── Canvas resize helpers ────────────────────────────────────────────────────

async function resizeCanvasForExport(map: any, targetW: number, targetH: number, refPose: AppSnapshot) {
  const container = map.getContainer()
  const prev = {
    width: container.style.width, height: container.style.height,
    position: container.style.position, zIndex: container.style.zIndex,
    pixelRatio: map.getPixelRatio(),
  }
  container.style.position = "absolute"
  container.style.left = "0"
  container.style.top = "0"
  container.style.zIndex = "0"
  container.style.width = `${targetW}px`
  container.style.height = `${targetH}px`
  map.setPixelRatio(1)
  map.resize()
  map._update()
  await new Promise(r => requestAnimationFrame(r))
  await new Promise(r => requestAnimationFrame(r))
  applyProgress(0, refPose, refPose, map, undefined, undefined)
  map.triggerRepaint()
  await new Promise(r => requestAnimationFrame(r))
  return prev
}

async function restoreCanvas(map: any, prev: any) {
  const container = map.getContainer()
  container.style.width = prev.width
  container.style.height = prev.height
  container.style.position = prev.position
  container.style.zIndex = prev.zIndex
  map.setPixelRatio(prev.pixelRatio)
  map.resize()
  map._update()
  await new Promise(r => requestAnimationFrame(r))
}

function reviveMapInteractions(map: any) {
  map.resize()
  map._update()
  map.getCanvas().dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
}

// ─── Video export functions (unchanged) ───────────────────────────────────────
// Import these from a separate file in production, kept inline for brevity.

async function exportVideoMediaRecorder(
  canvas: HTMLCanvasElement, fps: number, durationMs: number,
  extraFramesPerStep: number,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const chunks: Blob[] = []
  const codecOptions = [
    { mimeType: "video/webm;codecs=vp9", name: "MediaRecorder (VP9)" },
    { mimeType: "video/webm;codecs=vp8", name: "MediaRecorder (VP8)" },
    { mimeType: "video/webm",            name: "MediaRecorder (WebM)" },
  ]
  const selected = codecOptions.find(c => MediaRecorder.isTypeSupported(c.mimeType)) ?? codecOptions[2]
  const stream = canvas.captureStream(0)
  const recorder = new MediaRecorder(stream, { mimeType: selected.mimeType, videoBitsPerSecond: 12_000_000 })
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => resolve(new Blob(chunks, { type: selected.mimeType }))
    recorder.onerror = reject
    recorder.start()
    let i = 0
    const next = async () => {
      if (i >= totalFrames) { recorder.stop(); return }
      await recordFrame(i, totalFrames)
      for (let f = 0; f < 2 + extraFramesPerStep; f++) await new Promise(r => requestAnimationFrame(r))
      const track = stream.getVideoTracks()[0] as any
      track.requestFrame?.()
      onProgress((i + 1) / totalFrames, `Exporting via ${selected.name}`)
      i++
      requestAnimationFrame(next)
    }
    next()
  })
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CRUISE_DEG_PER_MS = 360 / 30_000
const EASE_MS = 1_500
const FOV_ANI_MS = 800

// ─── Props ────────────────────────────────────────────────────────────────────

interface CameraButtonsProps {
  mapRef: React.RefObject<MapRef>
  /** Full nuqs state from TerrainViewer — used for numericState extraction in "complete" mode */
  appState?: Record<string, unknown>
  /** setState for the app state (nuqs or local-safe setter) */
  setAppState?: (state: Record<string, unknown>, shallow?: boolean) => void
  /** Safe setter that buffers during animation to avoid nuqs conflicts */
  setAppStateSafe?: (state: Record<string, unknown>, shallow?: boolean) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CameraButtons({ mapRef, appState, setAppState, setAppStateSafe }: CameraButtonsProps) {

  // ═══ URL-controlled state (nuqs) ═══════════════════════════════════════════
  const [animParams, setAnimParams] = useQueryStates({
    animDuration:     parseAsFloat.withDefault(3),
    animLoopMode:     parseAsString.withDefault("bounce"),
    animSmoothCamera: parseAsBoolean.withDefault(false),
    animPlaying:      parseAsBoolean.withDefault(false),
    animPlaying360:   parseAsBoolean.withDefault(false),
    animPose1:        parseAsSnapshot.withDefault(null as any),
    // Stored as a delta from pose1 (see subtractSnapshots/addSnapshots below), not an
    // absolute snapshot — deltas tend to be small so there's nothing extra to compress.
    animPose2Delta:   parseAsSnapshot.withDefault(null as any),
  }, { shallow: true })

  const {
    animDuration: durationSec,
    animLoopMode: loopModeStr,
    animSmoothCamera: smoothCamera,
    animPlaying: playing,
    animPlaying360: spinning,
    animPose1: pose1,
    animPose2Delta: pose2Delta,
  } = animParams

  const pose2 = useMemo(
    () => (pose1 && pose2Delta ? addSnapshots(pose1, pose2Delta) : null),
    [pose1, pose2Delta],
  )

  const loopMode = loopModeStr as LoopMode
  const durationMs = durationSec * 1_000

  // Setters (all go to URL)
  const setDurationSec = (v: number) => setAnimParams({ animDuration: v })
  const setLoopMode = (v: LoopMode) => setAnimParams({ animLoopMode: v })
  const setSmoothCamera = (v: boolean) => setAnimParams({ animSmoothCamera: v })
  const setPlaying = (v: boolean) => setAnimParams({ animPlaying: v })
  const setSpinning = (v: boolean) => setAnimParams({ animPlaying360: v })
  const setPose1 = (v: AppSnapshot | null) => {
    // Re-deriving pose1 keeps the existing pose2 delta, which shifts pose2's
    // absolute position along with it — that's the inherent trade-off of
    // storing pose2 relative to pose1.
    setAnimParams({ animPose1: v as any })
  }
  // pose1 must exist first — pose2 is only meaningful as a delta from it.
  const setPose2 = (v: AppSnapshot | null) => {
    setAnimParams({ animPose2Delta: (v && pose1 ? subtractSnapshots(v, pose1) : null) as any })
  }

  // ═══ Atoms with storage (export settings) ═════════════════════════════════
  const [resolutionKey, setResolutionKey] = useAtom(resolutionKeyAtom)
  const [renderQuality, setRenderQuality] = useAtom(renderQualityAtom)
  const [fps, setFps] = useAtom(fpsAtom)
  const [targetSizeMB, setTargetSizeMB] = useAtom(targetSizeMBAtom)

  // ═══ Local state (component-only) ═════════════════════════════════════════
  const [progress, setProgress] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportCodec, setExportCodec] = useState("")

  // ═══ Derived ══════════════════════════════════════════════════════════════
  const canPlay = !!pose1 && !!pose2
  const selectedResolution = EXPORT_RESOLUTIONS.find(r => r.label === resolutionKey) ?? EXPORT_RESOLUTIONS[2]
  const selectedQuality = RENDER_QUALITY_OPTIONS.find(q => q.value === renderQuality) ?? RENDER_QUALITY_OPTIONS[1]
  const targetSizeBytes = targetSizeMB !== "" && parseFloat(targetSizeMB) > 0
    ? Math.round(parseFloat(targetSizeMB) * 1024 * 1024) : undefined

  // In smoothCamera mode, only interpolate camera; in complete mode also interpolate numericState
  const onAppStateChange = smoothCamera ? setAppStateSafe : setAppState
  const effectiveAppState = smoothCamera ? undefined : appState

  // ═══ Stable refs for RAF callbacks ════════════════════════════════════════
  const durationMsRef = useRef(durationMs)
  const loopRef = useRef(loopMode)
  const p1Ref = useRef(pose1)
  const p2Ref = useRef(pose2)
  const appRef = useRef(effectiveAppState)
  const cbRef = useRef(onAppStateChange)

  useEffect(() => { durationMsRef.current = durationMs }, [durationMs])
  useEffect(() => { loopRef.current = loopMode }, [loopMode])
  useEffect(() => { p1Ref.current = pose1 }, [pose1])
  useEffect(() => { p2Ref.current = pose2 }, [pose2])
  useEffect(() => { appRef.current = effectiveAppState }, [effectiveAppState])
  useEffect(() => { cbRef.current = onAppStateChange }, [onAppStateChange])

  // Playback timing refs
  const playStartRef = useRef(0)
  const playOffsetRef = useRef(0)
  const bounceDir = useRef<1 | -1>(1)

  // Spin timing refs
  const spinLastRef = useRef<number | null>(null)
  const spinElapsed = useRef(0)
  const stoppingRef = useRef<number | null>(null)

  // ═══ Sync running state on mount (survive sidebar reopen) ═════════════════
  useEffect(() => {
    // If URL says playing but engine stopped (e.g. animation finished while unmounted)
    if (playing && !animEngine.isRunning()) {
      startPlay(progress >= 1 ? 0 : progress)
    }
    if (spinning && !spinEngine.isRunning()) {
      doStartSpin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

  // ═══ FOV ══════════════════════════════════════════════════════════════════
  const setVFov = useCallback((targetDeg: number) => {
    const map = getMap(mapRef)
    if (!map) return
    const startFov = map.getVerticalFieldOfView()
    const startTime = performance.now()
    fovEngine.start((now) => {
      const t = Math.min((now - startTime) / FOV_ANI_MS, 1)
      map.setVerticalFieldOfView(lerp(startFov, targetDeg, smoothstep(t)))
      map.triggerRepaint()
      if (t >= 1) { requestAnimationFrame(() => map.resize()); return false }
      return true
    })
  }, [mapRef])

  // ═══ Snapshot capture ═════════════════════════════════════════════════════
  const captureSnapshot = useCallback((): AppSnapshot | null => {
    const map = getMap(mapRef)
    if (!map) return null
    const c = map.getCenter()
    const canvas = map.getCanvas()
    return {
      pose: {
        lat: c.lat, lng: c.lng, zoom: map.getZoom(),
        pitch: map.getPitch(), bearing: map.getBearing(),
        roll: (map as any).getRoll?.() ?? 0,
        vfov: map.getVerticalFieldOfView(),
        refWidth: canvas.clientWidth,
      },
      numericState: appState ? extractNumbers(appState) : {},
    }
  }, [mapRef, appState])

  // ═══ Keyframe playback ════════════════════════════════════════════════════
  const stopPlay = useCallback(() => {
    animEngine.stop()
    const map = getMap(mapRef)
    map?.setCenterClampedToGround(false)
    setPlaying(false)
  }, [mapRef, setPlaying])

  const startPlay = useCallback((fromProgress = 0) => {
    if (!p1Ref.current || !p2Ref.current) return
    animEngine.stop()
    bounceDir.current = 1
    playOffsetRef.current = clamp(fromProgress, 0, 1)
    playStartRef.current = performance.now()
    setPlaying(true)

    animEngine.start((now) => {
      const p1 = p1Ref.current; const p2 = p2Ref.current
      const map = getMap(mapRef)
      map?.setCenterClampedToGround(false)
      if (!p1 || !p2 || !map) { setPlaying(false); return false }

      const elapsed = now - playStartRef.current
      let raw = clamp(playOffsetRef.current + elapsed / durationMsRef.current, 0, 1)
      const mode = loopRef.current

      if (raw >= 1) {
        if (mode === "none") {
          applyProgress(1, p1, p2, map, appRef.current, cbRef.current, true)
          setProgress(1); setPlaying(false); return false
        }
        if (mode === "forward") { playStartRef.current = now; playOffsetRef.current = 0; raw = 0 }
        if (mode === "bounce") {
          bounceDir.current = bounceDir.current === 1 ? -1 : 1
          playStartRef.current = now; playOffsetRef.current = 0; raw = 0
        }
      }

      const displayRaw = bounceDir.current === 1 ? raw : 1 - raw
      applyProgress(displayRaw, p1, p2, map, appRef.current, cbRef.current, true)
      setProgress(displayRaw)
      return true // continue
    })
  }, [mapRef, setPlaying])

  const handleScrub = useCallback((vals: number[]) => {
    const raw = vals[0] / 100
    const p1 = p1Ref.current; const p2 = p2Ref.current; const map = getMap(mapRef)
    if (!p1 || !p2 || !map) return
    setProgress(raw)
    applyProgress(raw, p1, p2, map, appRef.current, cbRef.current, false)
    if (playing) { playOffsetRef.current = raw; playStartRef.current = performance.now() }
  }, [playing, mapRef])

  // ═══ 360° spin ════════════════════════════════════════════════════════════
  const doStartSpin = useCallback(() => {
    const map = getMap(mapRef)
    if (!map) return
    spinLastRef.current = null; spinElapsed.current = 0; stoppingRef.current = null
    setSpinning(true)

    spinEngine.start((now) => {
      const delta = spinLastRef.current !== null ? now - spinLastRef.current : 0
      spinLastRef.current = now; spinElapsed.current += delta
      const speedIn = smoothstep(Math.min(spinElapsed.current / EASE_MS, 1))
      let mul: number
      if (stoppingRef.current) {
        const tOut = Math.min((now - stoppingRef.current) / EASE_MS, 1)
        mul = (1 - smoothstep(tOut)) * speedIn
        if (tOut >= 1) { stoppingRef.current = null; setSpinning(false); return false }
      } else { mul = speedIn }
      map.setBearing((map.getBearing() + CRUISE_DEG_PER_MS * delta * mul) % 360)
      return true
    })
  }, [mapRef, setSpinning])

  const triggerStopSpin = useCallback(() => {
    if (spinEngine.isRunning() && !stoppingRef.current) stoppingRef.current = performance.now()
  }, [])

  const toggleSpin = useCallback(() => {
    spinning ? triggerStopSpin() : doStartSpin()
  }, [spinning, triggerStopSpin, doStartSpin])

  // ═══ Video export ═════════════════════════════════════════════════════════
  const handleExportVideo = useCallback(async () => {
    const p1 = p1Ref.current; const p2 = p2Ref.current
    const map = getMap(mapRef); const canvas = map?.getCanvas()
    if (!p1 || !p2 || !map || !canvas) return

    stopPlay()
    setExporting(true); setExportProgress(0); setExportCodec("")

    let targetW = selectedResolution.width; let targetH = selectedResolution.height
    if (targetW === 0) {
      targetW = canvas.width % 2 === 0 ? canvas.width : canvas.width + 1
      targetH = canvas.height % 2 === 0 ? canvas.height : canvas.height + 1
    }

    const onProgress = (p: number, codec: string) => { setExportProgress(p); setExportCodec(codec) }
    const recordFrame = async (frameIndex: number, totalFrames: number) => {
      applyProgress(frameIndex / totalFrames, p1, p2, map, appRef.current, cbRef.current, true)
    }

    let prev
    try {
      prev = await resizeCanvasForExport(map, targetW, targetH, p1)
      const videoBlob = await exportVideoMediaRecorder(
        canvas, fps, durationMsRef.current, selectedQuality.extraFrames, onProgress, recordFrame
      )
      const url = URL.createObjectURL(videoBlob)
      const a = document.createElement("a")
      a.href = url; a.download = `terrain-${Date.now()}.webm`; a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Video export failed:", error)
      alert(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      await restoreCanvas(map, prev)
      reviveMapInteractions(map)
      applyProgress(0, p1, p2, map, appRef.current, cbRef.current, false)
      setProgress(0); setExporting(false)
      map?.setCenterClampedToGround(false)
    }
  }, [mapRef, stopPlay, selectedResolution, selectedQuality, targetSizeBytes, fps])

  // ═══ Cleanup on unmount — do NOT stop engines, just detach ════════════════
  // We intentionally do NOT stop engines on unmount so animation continues
  // while sidebar is closed. User can stop via play/pause when sidebar reopens.

  // ═══ Render ═══════════════════════════════════════════════════════════════
  return (
    <>
      {/* ── FOV / Spin ── */}
      <Label className="text-sm font-medium">Animation & FOV</Label>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-[2] bg-transparent cursor-pointer" onClick={() => setVFov(40)}>
          VFOV 40°
        </Button>
        <Button variant={spinning ? "default" : "outline"} className="flex-[2] cursor-pointer" onClick={toggleSpin}>
          {spinning ? "Stop" : "360°"}
        </Button>
        <Button variant="outline" className="flex-[2] bg-transparent cursor-pointer" onClick={() => setVFov(10)}>
          VFOV 10°
        </Button>
      </div>

      {/* ── Poses ── */}
      <div className="flex items-center justify-between mt-3">
        <Label className="text-sm font-medium">Animation via Keyframe</Label>
        <div className="flex items-center gap-2 cursor-pointer">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Label className="text-xs text-muted-foreground">Complete</Label>
              </TooltipTrigger>
              <TooltipContent className="text-xs max-w-xs">
                Smooth: animates only camera poses.<br />
                Complete: also animates numeric state (opacities, illumination, etc.)
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch
            checked={smoothCamera}
            onCheckedChange={setSmoothCamera}
            className="h-5 w-9 bg-muted data-[state=checked]:bg-primary rounded-full p-1 cursor-pointer border-transparent"
          />
          <Label className="text-xs text-muted-foreground">Smooth</Label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant={pose1 ? "secondary" : "outline"}
          className="flex-[3] bg-transparent cursor-pointer"
          onClick={() => { const s = captureSnapshot(); if (s) setPose1(s) }}
        >
          {pose1 ? <span className="flex items-center gap-1.5">Pose 1 <Check className="h-4 w-4" /></span> : "Set Pose 1"}
        </Button>
        <Button
          variant={playing ? "default" : "outline"}
          className="flex-[2] cursor-pointer"
          disabled={!canPlay || exporting}
          onClick={playing ? stopPlay : () => startPlay(progress >= 1 ? 0 : progress)}
        >
          {playing
            ? <><Pause className="h-4 w-4 mr-1" />Stop</>
            : <><Play className="h-4 w-4 mr-1" />Play</>}
        </Button>
        <Button
          variant={pose2 ? "secondary" : "outline"}
          className="flex-[3] bg-transparent cursor-pointer"
          disabled={!pose1}
          title={!pose1 ? "Set Pose 1 first — Pose 2 is stored as a delta from it" : undefined}
          onClick={() => { const s = captureSnapshot(); if (s) setPose2(s) }}
        >
          {pose2 ? <span className="flex items-center gap-1.5">Pose 2 <Check className="h-4 w-4" /></span> : "Set Pose 2"}
        </Button>
      </div>

      {/* Pose debug */}
      {(pose1 || pose2) && (
        <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-x-2">
          {pose1 && <span title={JSON.stringify(pose1.pose, null, 2)}>z{pose1.pose.zoom.toFixed(1)} {pose1.pose.lng.toFixed(2)}°/{pose1.pose.lat.toFixed(2)}°</span>}
          {pose2 && <span title={JSON.stringify(pose2.pose, null, 2)} className="text-right">z{pose2.pose.zoom.toFixed(1)} {pose2.pose.lng.toFixed(2)}°/{pose2.pose.lat.toFixed(2)}°</span>}
        </div>
      )}

      {/* ── Timeline ── */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0">
          {canPlay ? `${(progress * durationMs / 1000).toFixed(1)}s` : "0.0s"}
        </span>
        <Slider
          min={0} max={100} step={0.5}
          value={[Math.round(progress * 100)]}
          onValueChange={handleScrub}
          disabled={!canPlay || exporting}
          className="flex-1 cursor-pointer"
        />
        <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0 text-right">
          {canPlay ? `${(durationMs / 1000).toFixed(1)}s` : "--"}
        </span>
      </div>

      {/* ── Duration + Loop ── */}
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Duration (s)</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number" min={0.5} max={300} step={0.5}
              value={durationSec}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setDurationSec(v) }}
              disabled={exporting}
              className="w-full h-8 text-xs px-2"
            />
            <span className="text-xs text-muted-foreground shrink-0">s</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Loop</Label>
          <Select value={loopMode} onValueChange={v => setLoopMode(v as LoopMode)} disabled={exporting}>
            <SelectTrigger className="h-8 text-xs w-full cursor-pointer"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="forward">Forward ↻</SelectItem>
              <SelectItem value="bounce">Bounce ↔</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Export ── */}
      <Label className="text-sm font-medium mt-3">Export Video</Label>
      <div className="flex gap-2 items-start">
        <div className="flex flex-col gap-1 flex-[2] min-w-0">
          <Label className="text-xs text-muted-foreground leading-none pb-[2px]">Resolution</Label>
          <Select value={resolutionKey} onValueChange={setResolutionKey} disabled={exporting}>
            <SelectTrigger className="h-8 text-xs w-full cursor-pointer leading-none"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPORT_RESOLUTIONS.map(r => <SelectItem key={r.label} value={r.label}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 flex-[1] max-w-[90px]">
          <Label className="text-xs text-muted-foreground leading-none pb-[2px]">FPS</Label>
          <Input type="number" min={1} max={120} step={1} value={fps}
            onChange={e => setFps(parseInt(e.target.value, 10))} disabled={exporting}
            className="h-9 w-full text-xs px-2 leading-none" />
        </div>
        <div className="flex flex-col gap-1 flex-[2] min-w-0">
          <Label className="text-xs text-muted-foreground leading-none pb-[2px]">Render quality</Label>
          <Select value={renderQuality} onValueChange={v => setRenderQuality(v as RenderQuality)} disabled={exporting}>
            <SelectTrigger className="h-8 text-xs w-full cursor-pointer leading-none"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RENDER_QUALITY_OPTIONS.map(q => <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button variant="outline" className="w-full cursor-pointer mt-2"
        disabled={!canPlay || exporting} onClick={handleExportVideo}
        title={!canPlay ? "Capture both poses first" : undefined}>
        {exporting ? (
          <><Download className="h-4 w-4 mr-2 animate-pulse" />{exportCodec || "Exporting…"}{exportCodec && ` ${Math.round(exportProgress * 100)}%`}</>
        ) : (
          <><Video className="h-4 w-4 mr-2" />Export Video</>
        )}
      </Button>
    </>
  )
}

// ─── AnimationSection wrapper ─────────────────────────────────────────────────

interface AnimationSectionProps {
  mapRef: RefObject<MapRef>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  appState: Record<string, unknown>
  setAppState: (state: Record<string, unknown>, shallow?: boolean) => void
  setAppStateSafe: (state: Record<string, unknown>, shallow?: boolean) => void
}

export function AnimationSection({
  mapRef, isOpen, onOpenChange,
  appState, setAppState, setAppStateSafe,
}: AnimationSectionProps) {
  return (
    <Section title="Tools: Animation" isOpen={isOpen} onOpenChange={onOpenChange}>
      <CameraButtons
        mapRef={mapRef}
        appState={appState}
        setAppState={setAppState}
        setAppStateSafe={setAppStateSafe}
      />
    </Section>
  )
}

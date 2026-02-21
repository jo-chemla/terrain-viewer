/**
 * CameraButtons.tsx
 */

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "../ui/label"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MapRef } from "react-map-gl/maplibre"
import { Play, Pause, Check, Video, Download } from 'lucide-react'
import { useNuqsAnimationSafeSetter } from "@/lib/useNuqsAnimationSafeSetter"
import { CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget } from 'mediabunny'
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// ─── Types ────────────────────────────────────────────────────────────────────

interface CameraPose {
  lat: number; lng: number; zoom: number
  pitch: number; bearing: number; roll: number; vfov: number; 
  refWidth: number // canvas width at capture time
}

interface AppSnapshot {
  pose: CameraPose
  numericState: Record<string, number>
}

type LoopMode = "none" | "forward" | "bounce"
type RenderQuality = "quick" | "normal" | "hq"

interface ExportResolution {
  label: string
  width: number
  height: number
}

const EXPORT_RESOLUTIONS: ExportResolution[] = [
  { label: "Quick 360p 16:9",  width: 640,  height: 360  },
  { label: "720p 16:9",        width: 1280, height: 720  },
  { label: "1080p FHD 16:9",   width: 1920, height: 1080 },
  { label: "4K UHD 16:9",      width: 3840, height: 2160 },
  { label: "Native",           width: 0,    height: 0    },
  { label: "1080×1080 1:1",    width: 1080, height: 1080 },
  { label: "2048×2048 1:1",    width: 2048, height: 2048 },
]

const RENDER_QUALITY_OPTIONS: {
  value: RenderQuality
  label: string
  extraFrames: number
}[] = [
  { value: "quick",  label: "Quick (0 extra frames)",  extraFrames: 0  },
  { value: "normal", label: "Normal (2 extra frames)", extraFrames: 2  },
  { value: "hq",     label: "HQ (10 extra frames)",    extraFrames: 10 },
]

// Platform file-size limits shown as presets for the max-size input
const PLATFORM_SIZE_PRESETS: { label: string; bytes: number }[] = [
  { label: "Clipboard safe (~5 MB)",   bytes: 5   * 1024 * 1024           },
  { label: "Mastodon (40 MB typical)", bytes: 40  * 1024 * 1024           },
  { label: "Bluesky (50 MB)",          bytes: 50  * 1024 * 1024           },
  { label: "Twitter / X (512 MB)",     bytes: 512 * 1024 * 1024           },
  { label: "Threads (1 GB)",           bytes: 1   * 1024 * 1024 * 1024    },
  { label: "Instagram (4 GB)",         bytes: 4   * 1024 * 1024 * 1024    },
  { label: "LinkedIn (5 GB)",          bytes: 5   * 1024 * 1024 * 1024    },
  { label: "TikTok (287 MB)",          bytes: 287 * 1024 * 1024           },
  { label: "No limit",                 bytes: 0                           },
]

interface CameraButtonsProps {
  mapRef: React.RefObject<MapRef>
  state?: Record<string, unknown>
  setState?: (state: Record<string, unknown>, shallow?: boolean) => void
  setIsSidebarOpen?: (open: boolean) => void
}

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
    const val  = obj[key]
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 *
 * Uses jumpTo instead of easeTo — jumpTo is synchronous and bypasses the
 * animation pipeline, so it correctly re-asserts pose after a canvas resize.
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

  const canvasWidth = map.getCanvas().clientWidth
  const baseZoom = lerp(p1.pose.zoom, p2.pose.zoom, t)
  const refWidth = lerp(p1.pose.refWidth, p2.pose.refWidth, t)

  map.jumpTo({ 
    center:  [lerp(p1.pose.lng, p2.pose.lng, t), lerp(p1.pose.lat, p2.pose.lat, t)],
    // zoom:    lerp(p1.pose.zoom,  p2.pose.zoom,  t),
    zoom: correctedZoom(baseZoom, canvasWidth, refWidth),
    pitch:   lerp(p1.pose.pitch, p2.pose.pitch, t),
    bearing: lerpAngle(p1.pose.bearing, p2.pose.bearing, t),
  })
  // ease-to does not follow terrain, which jumpto does
  // map.easeTo({
  //   center:  [lerp(p1.pose.lng, p2.pose.lng, t), lerp(p1.pose.lat, p2.pose.lat, t)],
  //   zoom:    lerp(p1.pose.zoom,  p2.pose.zoom,  t),
  //   pitch:   lerp(p1.pose.pitch, p2.pose.pitch, t),
  //   bearing: lerpAngle(p1.pose.bearing, p2.pose.bearing, t),
  //   duration: 0,
  //   animate: false,    
  // })
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

interface CanvasSnapshot {
  width: number; height: number
  styleWidth: string; styleHeight: string
  pixelRatio: number
}

function snapshotCanvas(canvas: HTMLCanvasElement, map: any): CanvasSnapshot {
  return {
    width: canvas.width, 
    height: canvas.height,
    styleWidth:  canvas.style.width,
    styleHeight: canvas.style.height,
    pixelRatio:  map.getPixelRatio(),
  }
}

async function resizeCanvasForExport(
  map: any,
  targetW: number,
  targetH: number,
  refPose: AppSnapshot
) {
  const container = map.getContainer()

  const prev = {
    width: container.style.width,
    height: container.style.height,
    position: container.style.position,
    zIndex: container.style.zIndex,
    pixelRatio: map.getPixelRatio(),
  }

  // isolate layout for export
  container.style.position = "absolute"
  container.style.left = "0"
  container.style.top  = "0"
  container.style.zIndex = "0" // don't break pointer events

  container.style.width  = `${targetW}px`
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
  container.style.width    = prev.width
  container.style.height   = prev.height
  container.style.position = prev.position
  container.style.zIndex   = prev.zIndex

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

async function exportVideoMediaBunny(
  canvas: HTMLCanvasElement,
  fps: number,
  durationMs: number,
  extraFramesPerStep: number,
  targetSizeBytes: number | undefined,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const chunks: Uint8Array[] = []

  const bitrateOverride = targetSizeBytes && targetSizeBytes > 0
    ? Math.floor((targetSizeBytes * 8) / (durationMs / 1000) * 0.85)
    : undefined

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
    target: new StreamTarget(new WritableStream({
      write(chunk) { chunks.push(chunk.data) }
    })),
  })

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: bitrateOverride ?? QUALITY_HIGH,
    keyFrameInterval: 1.0,
    latencyMode: 'quality',
  })

  output.addVideoTrack(videoSource, { frameRate: fps })
  await output.start()

  try {
    for (let i = 0; i < totalFrames; i++) {
      await recordFrame(i, totalFrames)
      for (let f = 0; f < 2 + extraFramesPerStep; f++) {
        await new Promise(r => requestAnimationFrame(r))
      }
      await videoSource.add(i / fps, 1 / fps)
      onProgress((i + 1) / totalFrames, 'Exporting via MediaBunny (H.264)')
    }
    await output.finalize()
    const mimeType = await output.getMimeType()
    return new Blob(chunks, { type: mimeType })
  } catch (err) {
    await output.cancel()
    throw err
  }
}

// ─── Video export: WebCodecs ──────────────────────────────────────────────────

function getAvcLevel(width: number, height: number): string {
  const area = width * height
  if (area <= 414720)  return 'avc1.42E01E'
  if (area <= 983040)  return 'avc1.42E014'
  if (area <= 2228224) return 'avc1.42E01F'
  if (area <= 8912896) return 'avc1.42E028'
  return 'avc1.42E033'
}

async function exportVideoWebCodecs(
  canvas: HTMLCanvasElement,
  fps: number,
  durationMs: number,
  extraFramesPerStep: number,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const { width, height } = canvas

  if (!('VideoEncoder' in window)) throw new Error('WebCodecs API not supported')

  const chunks: Uint8Array[] = []
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push(data)
    },
    error: (e) => { throw e },
  })

  await encoder.configure({
    codec: getAvcLevel(width, height),
    width, height,
    bitrate: 8_000_000,
    framerate: fps,
    avc: { format: 'avc' },
  })

  for (let i = 0; i < totalFrames; i++) {
    await recordFrame(i, totalFrames)
    for (let f = 0; f < 2 + extraFramesPerStep; f++) {
      await new Promise(r => requestAnimationFrame(r))
    }
    const bitmap = await createImageBitmap(canvas)
    const frame  = new VideoFrame(bitmap, {
      timestamp: (i / fps) * 1_000_000,
      duration:  (1 / fps) * 1_000_000,
    })
    encoder.encode(frame, { keyFrame: i % 30 === 0 })
    frame.close()
    bitmap.close()
    onProgress((i + 1) / totalFrames, 'Exporting via WebCodecs (H.264)')
  }

  await encoder.flush()
  encoder.close()

  const total = chunks.reduce((s, c) => s + c.byteLength, 0)
  const data  = new Uint8Array(total)
  let offset  = 0
  for (const c of chunks) { data.set(c, offset); offset += c.byteLength }
  return new Blob([data], { type: 'video/mp4' })
}

// ─── Video export: MediaRecorder ──────────────────────────────────────────────

async function exportVideoMediaRecorder(
  canvas: HTMLCanvasElement,
  fps: number,
  durationMs: number,
  extraFramesPerStep: number,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const chunks: Blob[] = []

  const codecOptions = [
    { mimeType: 'video/webm;codecs=vp9', name: 'MediaRecorder (VP9)' },
    { mimeType: 'video/webm;codecs=vp8', name: 'MediaRecorder (VP8)' },
    { mimeType: 'video/webm',            name: 'MediaRecorder (WebM)' },
  ]
  const selected = codecOptions.find(c => MediaRecorder.isTypeSupported(c.mimeType)) ?? codecOptions[2]

  const stream   = canvas.captureStream(0)
  const recorder = new MediaRecorder(stream, {
    mimeType: selected.mimeType,
    videoBitsPerSecond: 12_000_000,
  })

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop  = () => resolve(new Blob(chunks, { type: selected.mimeType }))
    recorder.onerror = reject
    recorder.start()

    let i = 0
    const next = async () => {
      if (i >= totalFrames) { recorder.stop(); return }
      await recordFrame(i, totalFrames)
      for (let f = 0; f < 2 + extraFramesPerStep; f++) {
        await new Promise(r => requestAnimationFrame(r))
      }
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
const EASE_MS    = 1_500
const FOV_ANI_MS = 800

// ─── Component ────────────────────────────────────────────────────────────────

function correctedZoom(baseZoom: number, canvasWidth: number, referenceWidth: number) {
  if (!referenceWidth || referenceWidth <= 0) return baseZoom
  return baseZoom + Math.log2(canvasWidth / referenceWidth)
}

export function CameraButtons({ mapRef, state, setState, setIsSidebarOpen }: CameraButtonsProps) {
  const noop = () => {}
  const [localState, setLocalState] = useState(state ?? {})
  const setStateSafe = useNuqsAnimationSafeSetter(setState ?? noop, setLocalState)


  // Smoother view animation camera transition, but cannot animate ther params
  // const onAppStateChange = setStateSafe
  // const appState = localState
  
  // Less smooth but can animate other props like iz modes opacities etc
  // const onAppStateChange = setState
  // const appState = state

  const [smoothCamera, setSmoothCamera] = useState(false)
  const onAppStateChange = smoothCamera ? setStateSafe : setState
  const appState = smoothCamera ? localState : state


  // ── Spin ──────────────────────────────────────────────────────────────────────
  const spinRafRef  = useRef<number | null>(null)
  const stoppingRef = useRef<number | null>(null)
  const spinLastRef = useRef<number | null>(null)
  const spinElapsed = useRef(0)
  const [spinning, setSpinning] = useState(false)

  // ── FOV ──────────────────────────────────────────────────────────────────────
  const fovRafRef = useRef<number | null>(null)

  // ── Poses ─────────────────────────────────────────────────────────────────────
  const [pose1, setPose1] = useState<AppSnapshot | null>(null)
  const [pose2, setPose2] = useState<AppSnapshot | null>(null)

  // ── Playback ──────────────────────────────────────────────────────────────────
  const [durationSec, setDurationSec] = useState(3)
  const [loopMode,    setLoopMode]    = useState<LoopMode>("bounce")
  const durationMs = durationSec * 1_000

  const [playing,  setPlaying]  = useState(false)
  const [progress, setProgress] = useState(0)

  const poseRafRef    = useRef<number | null>(null)
  const playStartRef  = useRef<number>(0)
  const playOffsetRef = useRef<number>(0)
  const bounceDir     = useRef<1 | -1>(1)

  // ── Export ────────────────────────────────────────────────────────────────────
  const [exporting,      setExporting]      = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportCodec,    setExportCodec]    = useState("")
  const [resolutionKey,  setResolutionKey]  = useState("1080p FHD 16:9")
  const [renderQuality,  setRenderQuality]  = useState<RenderQuality>("normal")
  const [fps, setFps]                       = useState(60)
  const [targetSizeMB,   setTargetSizeMB]   = useState<string>("")

  const targetSizeBytes = targetSizeMB !== "" && parseFloat(targetSizeMB) > 0
    ? Math.round(parseFloat(targetSizeMB) * 1024 * 1024)
    : undefined

  const selectedResolution = EXPORT_RESOLUTIONS.find(r => r.label === resolutionKey) ?? EXPORT_RESOLUTIONS[2]
  const selectedQuality    = RENDER_QUALITY_OPTIONS.find(q => q.value === renderQuality) ?? RENDER_QUALITY_OPTIONS[1]

  // Stable refs
  const durationMsRef = useRef(durationMs); useEffect(() => { durationMsRef.current = durationMs }, [durationMs])
  const loopRef  = useRef(loopMode);   useEffect(() => { loopRef.current  = loopMode  }, [loopMode])
  const p1Ref    = useRef(pose1);      useEffect(() => { p1Ref.current    = pose1     }, [pose1])
  const p2Ref    = useRef(pose2);      useEffect(() => { p2Ref.current    = pose2     }, [pose2])
  const appRef   = useRef(appState);   useEffect(() => { appRef.current   = appState  }, [appState])
  const cbRef    = useRef(onAppStateChange); useEffect(() => { cbRef.current = onAppStateChange }, [onAppStateChange])

  // ── FOV ───────────────────────────────────────────────────────────────────────
  const setVFov = useCallback((targetDeg: number) => {
    const map = getMap(mapRef)
    if (!map) return
    if (fovRafRef.current) { cancelAnimationFrame(fovRafRef.current); fovRafRef.current = null }
    const startFov  = map.getVerticalFieldOfView()
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / FOV_ANI_MS, 1)
      map.setVerticalFieldOfView(lerp(startFov, targetDeg, smoothstep(t)))
      map.triggerRepaint()
      if (t < 1) fovRafRef.current = requestAnimationFrame(tick)
      else { fovRafRef.current = null; requestAnimationFrame(() => map.resize()) }
    }
    fovRafRef.current = requestAnimationFrame(tick)
  }, [mapRef])

  // ── Snapshot ──────────────────────────────────────────────────────────────────
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
        refWidth: canvas.clientWidth // <-- key line
      },
      numericState: appState ? extractNumbers(appState) : {},
    }
  }, [mapRef, appState])


  // ── Playback ──────────────────────────────────────────────────────────────────
  const stopPlay = useCallback(() => {
    if (poseRafRef.current) { cancelAnimationFrame(poseRafRef.current); poseRafRef.current = null }
    const map = getMap(mapRef)
    map?.setCenterClampedToGround(false)
    setPlaying(false)
  }, [mapRef])

  const rafTick = useCallback((now: number) => {
    const p1 = p1Ref.current; const p2 = p2Ref.current; 
    const map = getMap(mapRef)
    
    map?.setCenterClampedToGround(false)

    if (!p1 || !p2 || !map) { stopPlay(); return }
    const elapsed = now - playStartRef.current
    let raw = clamp(playOffsetRef.current + elapsed / durationMsRef.current, 0, 1)
    const mode = loopRef.current
    if (raw >= 1) {
      if (mode === "none") {
        applyProgress(1, p1, p2, map, appRef.current, cbRef.current, true)
        setProgress(1); setPlaying(false); poseRafRef.current = null; return
      }
      if (mode === "forward") { playStartRef.current = now; playOffsetRef.current = 0; raw = 0 }
      if (mode === "bounce")  { bounceDir.current = bounceDir.current === 1 ? -1 : 1; playStartRef.current = now; playOffsetRef.current = 0; raw = 0 }
    }
    const displayRaw = bounceDir.current === 1 ? raw : 1 - raw
    applyProgress(displayRaw, p1, p2, map, appRef.current, cbRef.current, true)
    setProgress(displayRaw)
    poseRafRef.current = requestAnimationFrame(rafTick)
  }, [mapRef, stopPlay])

  const startPlay = useCallback((fromProgress = 0) => {
    if (!p1Ref.current || !p2Ref.current) return
    stopPlay(); bounceDir.current = 1
    playOffsetRef.current = clamp(fromProgress, 0, 1)
    playStartRef.current  = performance.now()
    setPlaying(true)
    poseRafRef.current = requestAnimationFrame(rafTick)
  }, [stopPlay, rafTick])

  const handleScrub = useCallback((vals: number[]) => {
    const raw = vals[0] / 100
    const p1 = p1Ref.current; const p2 = p2Ref.current; const map = getMap(mapRef)
    if (!p1 || !p2 || !map) return
    setProgress(raw)
    applyProgress(raw, p1, p2, map, appRef.current, cbRef.current, false)
    if (playing) { playOffsetRef.current = raw; playStartRef.current = performance.now() }
  }, [playing, mapRef])

  // ── Video export ──────────────────────────────────────────────────────────────
  const handleExportVideo = useCallback(async () => {
    const p1 = p1Ref.current; const p2 = p2Ref.current
    const map = getMap(mapRef); const canvas = map?.getCanvas()
    if (!p1 || !p2 || !map || !canvas) return

    stopPlay()
    setExporting(true)
    setExportProgress(0)
    setExportCodec('')

    // const snap = snapshotCanvas(canvas, map)
    // const fps  = 60

    let targetW = selectedResolution.width
    let targetH = selectedResolution.height
    if (targetW === 0) {
      targetW = canvas.width  % 2 === 0 ? canvas.width  : canvas.width  + 1
      targetH = canvas.height % 2 === 0 ? canvas.height : canvas.height + 1
    }

    const onProgress = (p: number, codec: string) => {
      setExportProgress(p)
      setExportCodec(codec)
    }

    // Re-asserts camera pose every frame via jumpTo so resize doesn't shift anything
    const recordFrame = async (frameIndex: number, totalFrames: number) => {
      applyProgress(frameIndex / totalFrames, p1, p2, map, appRef.current, cbRef.current, true)
    }
    let prev
    try {
      // Resize then re-assert pose at p1 before recording starts
      // await resizeCanvasForExport(canvas, map, targetW, targetH, p1)
      prev = await resizeCanvasForExport(map, targetW, targetH, p1)

      let videoBlob: Blob
      let extension = 'mp4'

      try {
        videoBlob = await exportVideoMediaBunny(
          canvas, fps, durationMsRef.current,
          selectedQuality.extraFrames,
          targetSizeBytes,
          onProgress, recordFrame
        )
      } catch (e1) {
        console.warn('MediaBunny failed, trying WebCodecs:', e1)
        try {
          videoBlob = await exportVideoWebCodecs(
            canvas, fps, durationMsRef.current,
            selectedQuality.extraFrames,
            onProgress, recordFrame
          )
        } catch (e2) {
          console.warn('WebCodecs failed, falling back to MediaRecorder:', e2)
          videoBlob = await exportVideoMediaRecorder(
            canvas, fps, durationMsRef.current,
            selectedQuality.extraFrames,
            onProgress, recordFrame
          )
          extension = 'webm'
        }
      }

      // Clipboard for small files (browser support is limited for video/mp4)
      // const CLIPBOARD_LIMIT = 5 * 1024 * 1024
      let savedViaClipboard = false
      // if (videoBlob.size <= CLIPBOARD_LIMIT) {
      //   try {
      //     await navigator.clipboard.write([
      //       new ClipboardItem({ [videoBlob.type]: videoBlob })
      //     ])
      //     savedViaClipboard = true
      //     setExportCodec(prev => `${prev} — copied!`)
      //   } catch {
      //     // clipboard not supported for this mime type — fall through to download
      //   }
      // }

      if (!savedViaClipboard) {
        const url = URL.createObjectURL(videoBlob)
        const a   = document.createElement('a')
        a.href     = url
        a.download = `terrain-${Date.now()}.${extension}`
        a.click()
        URL.revokeObjectURL(url)
      }

    } catch (error) {
      console.error('Video export failed:', error)
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      // await restoreCanvas(canvas, map, snap)
await restoreCanvas(map, prev)
reviveMapInteractions(map)
      applyProgress(0, p1, p2, map, appRef.current, cbRef.current, false)
      setProgress(0)
      setExporting(false)
      map?.setCenterClampedToGround(false)
    }
  }, [mapRef, stopPlay, selectedResolution, selectedQuality, targetSizeBytes, fps])

  // ── 360 spin ──────────────────────────────────────────────────────────────────
  const triggerStop = useCallback(() => {
    if (spinRafRef.current && !stoppingRef.current) stoppingRef.current = performance.now()
  }, [])

  const startSpin = useCallback(() => {
    const map = getMap(mapRef)
    if (!map) return
    spinLastRef.current = null; spinElapsed.current = 0; stoppingRef.current = null
    setSpinning(true)
    const spinTick = (now: number) => {
      const delta = spinLastRef.current !== null ? now - spinLastRef.current : 0
      spinLastRef.current = now; spinElapsed.current += delta
      const speedIn = smoothstep(Math.min(spinElapsed.current / EASE_MS, 1))
      let mul: number
      if (stoppingRef.current) {
        const tOut = Math.min((now - stoppingRef.current) / EASE_MS, 1)
        mul = (1 - smoothstep(tOut)) * speedIn
        if (tOut >= 1) { stoppingRef.current = null; spinRafRef.current = null; setSpinning(false); return }
      } else { mul = speedIn }
      map.setBearing((map.getBearing() + CRUISE_DEG_PER_MS * delta * mul) % 360)
      spinRafRef.current = requestAnimationFrame(spinTick)
    }
    spinRafRef.current = requestAnimationFrame(spinTick)
  }, [mapRef])

  const toggleSpin = useCallback(() => spinning ? triggerStop() : startSpin(), [spinning, triggerStop, startSpin])

  // ─── Render ───────────────────────────────────────────────────────────────────
  const canPlay = !!pose1 && !!pose2

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
                  <Label className="text-xs text-muted-foreground">Smooth</Label>
              </TooltipTrigger>
              <TooltipContent className="text-xs max-w-xs">
                Smooth: animates only camera poses. <br />
                Complete: animates other numeric state values like opacities, illumination angles, etc.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Switch 
            checked={smoothCamera} 
            onCheckedChange={(val) => {
              setSmoothCamera(val)
              // try resetting to re-assert pose with the new mode — this can cause a jump if the two modes are out of sync, but at least it won't leave you in a broken state
              setPose1(null)
              setPose2(null)
              setProgress(0)
              stopPlay()
            }} 
            className="h-5 w-9 bg-muted data-[state=checked]:bg-primary rounded-full p-1 cursor-pointer border-transparent disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Label className="text-xs text-muted-foreground">Complete</Label>
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
            : <><Play  className="h-4 w-4 mr-1" />Play</>}
        </Button>
        <Button
          variant={pose2 ? "secondary" : "outline"}
          className="flex-[3] bg-transparent cursor-pointer"
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

      {/* Resolution + Quality on one row */}
      {/* Resolution + Quality on one row */}
      <div className="flex gap-2 items-start">
        
        {/* Resolution (importance 2) */}
        <div className="flex flex-col gap-1 flex-[2] min-w-0">
          <Label className="text-xs text-muted-foreground leading-none pb-[2px]">Resolution</Label>
          <Select value={resolutionKey} onValueChange={setResolutionKey} disabled={exporting}>
            <SelectTrigger className="h-8 text-xs w-full cursor-pointer leading-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPORT_RESOLUTIONS.map(r => (
                <SelectItem key={r.label} value={r.label}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* FPS (importance 1 — smaller) */}
        <div className="flex flex-col gap-1 flex-[1] max-w-[90px]">
          <Label className="text-xs text-muted-foreground leading-none pb-[2px]">FPS</Label>
          <Input
            type="number"
            min={1} max={120} step={1}
            placeholder="fps"
            value={fps}
            onChange={e => setFps(parseInt(e.target.value, 10))}
            disabled={exporting}
            className="h-9 w-full text-xs px-2 leading-none"
          />
        </div>

        {/* Quality (importance 2) */}
        <div className="flex flex-col gap-1 flex-[2] min-w-0">
          <Label className="text-xs text-muted-foreground leading-none pb-[2px]">Render quality</Label>
          <Select value={renderQuality} onValueChange={v => setRenderQuality(v as RenderQuality)} disabled={exporting}>
            <SelectTrigger className="h-8 text-xs w-full cursor-pointer leading-none"> 
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RENDER_QUALITY_OPTIONS.map(q => (
                <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

      </div>

      {/* Max file size — MB input + platform preset picker */}
      {/* <div className="mt-1.5 flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Max file size (MB)</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            min={0} step={1}
            placeholder="no limit"
            value={targetSizeMB}
            onChange={e => setTargetSizeMB(e.target.value)}
            disabled={exporting}
            className="h-8 text-xs px-2 w-24 shrink-0"
          />
          <Select
            value=""
            onValueChange={v => {
              const bytes = parseInt(v, 10)
              setTargetSizeMB(bytes > 0 ? String(Math.round(bytes / 1024 / 1024)) : "")
            }}
            disabled={exporting}
          >
            <SelectTrigger className="h-8 text-xs flex-1 cursor-pointer">
              <SelectValue placeholder="Platform presets…" />
            </SelectTrigger>
            <SelectContent>
              {PLATFORM_SIZE_PRESETS.map(p => (
                <SelectItem key={p.label} value={String(p.bytes)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div> */}

      {/* Export button */}
      <Button
        variant="outline"
        className="w-full cursor-pointer mt-2"
        disabled={!canPlay || exporting}
        onClick={handleExportVideo}
        title={!canPlay ? "Capture both poses first" : undefined}
      >
        {exporting ? (
          <>
            <Download className="h-4 w-4 mr-2 animate-pulse" />
            {exportCodec || "Exporting…"}
            {exportCodec && ` ${Math.round(exportProgress * 100)}%`}
          </>
        ) : (
          <>
            <Video className="h-4 w-4 mr-2" />
            Export Video
          </>
        )}
      </Button>
    </>
  )
}
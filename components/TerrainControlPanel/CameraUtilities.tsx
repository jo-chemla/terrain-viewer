/**
 * CameraButtons.tsx
 *
 * Controls for TerrainControlPanel:
 *   - FOV buttons + 360° spin
 *   - Set Pose 1 / Set Pose 2  (camera + optional full app-state snapshot)
 *   - Playback controls:
 *       · Duration (s) input  OR  Speed (×) input — toggled by a switch
 *       · Timeline scrub slider  (draggable while paused or during playback)
 *       · Loop mode selector: None | Forward | Bounce
 *       · ▶ Play / ■ Stop button
 *   - Export Video button (records animation and exports as MP4)
 *
 * Usage:
 *   <CameraButtons
 *     mapRef={mapRef}
 *     appState={appState}           // optional nested object — all numbers are lerped
 *     onAppStateChange={setter}
 *   />
 */

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "../ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
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

import {useNuqsAnimationSafeSetter} from "@/lib/useNuqsAnimationSafeSetter"

// ─── Video Export with MediaBunny ─────────────────────────────────────────────

import {
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
} from 'mediabunny'

async function exportVideoMediaBunny(
  canvas: HTMLCanvasElement,
  fps: number,
  durationMs: number,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const chunks: Uint8Array[] = []

  // Create output with MP4 format
  const output = new Output({
    format: new Mp4OutputFormat({ 
      fastStart: 'fragmented' // Creates streamable MP4
    }),
    target: new StreamTarget(new WritableStream({
      write(chunk) {
        chunks.push(chunk.data)
      },
    })),
  })

  // Add video track with canvas source
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc', // H.264
    bitrate: QUALITY_HIGH, // Or use a number like 12_000_000
    keyFrameInterval: 1.0, // Keyframe every 1 second
    latencyMode: 'quality', // Prioritize quality over speed
  })

  output.addVideoTrack(videoSource, { frameRate: fps })

  await output.start()

  try {
    // Render and add each frame with precise timing
    for (let i = 0; i < totalFrames; i++) {
      // Update scene to this frame
      await recordFrame(i, totalFrames)
      
      // Wait for render to complete (less waiting needed with MediaBunny)
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      // Add frame at exact timestamp
      const timestamp = i / fps
      const duration = 1 / fps
      await videoSource.add(timestamp, duration)
      
      onProgress((i + 1) / totalFrames, 'MediaBunny (H.264)')
    }

    // Finalize the video
    await output.finalize()

    // Create blob from chunks
    const mimeType = await output.getMimeType()
    return new Blob(chunks, { type: mimeType })
  } catch (error) {
    await output.cancel()
    throw error
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CameraPose {
  lat: number
  lng: number
  zoom: number
  pitch: number
  bearing: number
  roll: number
  vfov: number
}

interface AppSnapshot {
  pose: CameraPose
  /** flat dot-path → number map extracted from the caller's appState */
  numericState: Record<string, number>
}

type LoopMode = "none" | "forward" | "bounce"

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
  const diff = ((b - a + 540) % 360) - 180
  return a + diff * t
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

/** Apply a raw [0..1] progress to the map + optional appState. */
function applyProgress(
  raw: number,
  p1: AppSnapshot,
  p2: AppSnapshot,
  map: ReturnType<typeof getMap>,
  appState: Record<string, unknown> | undefined,
  onAppStateChange: ((s: Record<string, unknown>, shallow?: boolean) => void) | undefined,
  shallow?: boolean
) {
  if (!map) return
  const t = smootherstep(clamp(raw, 0, 1))
  // map.jumpTo({
  //   center:  [lerp(p1.pose.lng, p2.pose.lng, t), lerp(p1.pose.lat, p2.pose.lat, t)],
  //   zoom:    lerp(p1.pose.zoom,  p2.pose.zoom,  t),
  //   pitch:   lerp(p1.pose.pitch, p2.pose.pitch, t),
  //   bearing: lerpAngle(p1.pose.bearing, p2.pose.bearing, t),
  // })
  map.easeTo({
    center:  [lerp(p1.pose.lng, p2.pose.lng, t), lerp(p1.pose.lat, p2.pose.lat, t)],
    zoom:    lerp(p1.pose.zoom,  p2.pose.zoom,  t),
    pitch:   lerp(p1.pose.pitch, p2.pose.pitch, t),
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

// ─── Constants ────────────────────────────────────────────────────────────────

const CRUISE_DEG_PER_MS = 360 / 30_000
const EASE_MS    = 1_500
const FOV_ANI_MS = 800

// ─── Video Export with WebCodec API ───────────────────────────────────────────

// Determine appropriate AVC level based on resolution
function getAvcLevel(width: number, height: number): string {
  const codedArea = width * height
  
  // AVC level limits (coded area in pixels)
  if (codedArea <= 414720) return 'avc1.42E01E'   // Level 3.0 - up to 720x576
  if (codedArea <= 983040) return 'avc1.42E014'   // Level 2.0 - up to 1280x720
  if (codedArea <= 2228224) return 'avc1.42E01F'  // Level 3.1 - up to 1920x1080
  if (codedArea <= 8912896) return 'avc1.42E028'  // Level 4.0 - up to 4096x2304
  return 'avc1.42E033' // Level 5.1 - up to 8192x4320
}

async function exportVideoWebCodecs(
  canvas: HTMLCanvasElement,
  fps: number,
  durationMs: number,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const width = canvas.width
  const height = canvas.height

  // Check for WebCodecs API support
  if (!('VideoEncoder' in window)) {
    throw new Error('WebCodecs API not supported in this browser')
  }
  console.log('yooooo', {width, height, canvas})

  const chunks: Uint8Array[] = []

  // Create video encoder
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      console.log(chunk, metadata)
      const chunkData = new Uint8Array(chunk.byteLength)
      chunk.copyTo(chunkData)
      chunks.push(chunkData)
    },
    error: (e) => {
      console.error('Encoder error:', e)
      throw e
    }
  })

  // Configure encoder with appropriate AVC level for resolution
  const codec = getAvcLevel(width, height)
  const config: VideoEncoderConfig = {
    codec,
    width,
    height,
    bitrate: 8_000_000, // 12 Mbps for better quality
    framerate: fps,
    avc: { format: 'avc' }
  }

  await encoder.configure(config)

  // Capture and encode each frame synchronously
  for (let i = 0; i < totalFrames; i++) {
    // Update animation to this frame
    await recordFrame(i, totalFrames)
    
    // Wait for renders to complete
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    // Capture frame from canvas
    const imageBitmap = await createImageBitmap(canvas)
    
    // Create VideoFrame
    const frame = new VideoFrame(imageBitmap, {
      timestamp: (i / fps) * 1_000_000, // microseconds
      duration: (1 / fps) * 1_000_000
    })

    // Encode frame
    const keyFrame = i % 30 === 0 // Keyframe every 30 frames
    encoder.encode(frame, { keyFrame })
    
    // Clean up resources
    frame.close()
    imageBitmap.close()
    
    onProgress((i + 1) / totalFrames, 'WebCodecs (H.264)')
  }

  // Finalize encoding
  await encoder.flush()
  encoder.close()

  // Create raw H.264 data blob
  const totalSize = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0)
  const videoData = new Uint8Array(totalSize)
  let offset = 0
  for (const chunk of chunks) {
    videoData.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new Blob([videoData], { type: 'video/mp4' })
}

// MediaRecorder approach with frame-by-frame control
async function exportVideoMediaRecorder(
  canvas: HTMLCanvasElement,
  fps: number,
  durationMs: number,
  onProgress: (progress: number, codec: string) => void,
  recordFrame: (frameIndex: number, totalFrames: number) => Promise<void>
): Promise<Blob> {
  const totalFrames = Math.ceil((durationMs / 1000) * fps)
  const chunks: Blob[] = []
  
  // Try different codecs in order of preference
  const codecOptions = [
    { mimeType: 'video/webm;codecs=vp9', name: 'VP9' },
    { mimeType: 'video/webm;codecs=vp8', name: 'VP8' },
    { mimeType: 'video/webm', name: 'WebM' }
  ]
  
  let selectedCodec = codecOptions[0]
  for (const codec of codecOptions) {
    if (MediaRecorder.isTypeSupported(codec.mimeType)) {
      selectedCodec = codec
      break
    }
  }

  const stream = canvas.captureStream(0) // 0 = manual frame capture
  const options = {
    mimeType: selectedCodec.mimeType,
    videoBitsPerSecond: 12_000_000
  }

  const mediaRecorder = new MediaRecorder(stream, options)
  
  return new Promise((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    
    mediaRecorder.onstop = () => {
      resolve(new Blob(chunks, { type: selectedCodec.mimeType }))
    }
    
    mediaRecorder.onerror = reject
    
    mediaRecorder.start()
    
    // Frame-by-frame recording
    let frameIndex = 0
    
    const captureNextFrame = async () => {
      if (frameIndex >= totalFrames) {
        mediaRecorder.stop()
        return
      }
      
      // Update scene to this frame
      await recordFrame(frameIndex, totalFrames)
      
      // Wait for render to complete
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      
      // Request a frame from the stream
      const track = stream.getVideoTracks()[0] as any
      if (track.requestFrame) {
        track.requestFrame()
      }
      
      onProgress((frameIndex + 1) / totalFrames, `MediaRecorder (${selectedCodec.name})`)
      frameIndex++
      
      // Continue to next frame
      requestAnimationFrame(captureNextFrame)
    }
    
    captureNextFrame()
  })
}

// Convert WebM to MP4 using FFmpeg.wasm (optional enhancement)
async function convertWebMToMP4(webmBlob: Blob): Promise<Blob> {
  // This would require FFmpeg.wasm library
  // For now, return the original blob
  // In production, you could load FFmpeg.wasm and do:
  // const ffmpeg = createFFmpeg({ log: true })
  // await ffmpeg.load()
  // ... conversion logic
  return webmBlob
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CameraButtons({ mapRef, state, setState, setIsSidebarOpen }: CameraButtonsProps) {


  // const appState = state
  // const onAppStateChange = setState

  const noop = () => {}

  const [localState, setLocalState] = useState(state ?? {})
  const setStateSafe = useNuqsAnimationSafeSetter(setState ?? noop, setLocalState)

  const onAppStateChange = setStateSafe
  const appState = localState

  // ── 360 spin ─────────────────────────────────────────────────────────────────
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

  // ── Playback settings ─────────────────────────────────────────────────────────
  const [speedMode,   setSpeedMode]   = useState(false)
  const [durationSec, setDurationSec] = useState(3)
  const [speedMul,    setSpeedMul]    = useState(1)
  const [loopMode,    setLoopMode]    = useState<LoopMode>("bounce")

  /** Effective duration in ms */
  const durationMs = speedMode ? (3_000 / speedMul) : (durationSec * 1_000)

  // ── Playback runtime ──────────────────────────────────────────────────────────
  const [playing,  setPlaying]  = useState(false)
  const [progress, setProgress] = useState(0)   // 0..1 display value

  const poseRafRef    = useRef<number | null>(null)
  const playStartRef  = useRef<number>(0)        // performance.now() at last (re)start
  const playOffsetRef = useRef<number>(0)        // progress value at last (re)start
  const bounceDir     = useRef<1 | -1>(1)        // +1 forward, -1 backward (bounce mode)

  // ── Video export ──────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportCodec, setExportCodec] = useState<string>('')

  // Stable refs so the RAF tick always reads current values without re-creating itself
  const durationMsRef = useRef(durationMs)
  useEffect(() => { durationMsRef.current = durationMs }, [durationMs])
  const loopRef  = useRef(loopMode);   useEffect(() => { loopRef.current  = loopMode  }, [loopMode])
  const p1Ref    = useRef(pose1);      useEffect(() => { p1Ref.current    = pose1     }, [pose1])
  const p2Ref    = useRef(pose2);      useEffect(() => { p2Ref.current    = pose2     }, [pose2])
  const appRef   = useRef(appState);   useEffect(() => { appRef.current   = appState  }, [appState])
  const cbRef    = useRef(onAppStateChange);
  useEffect(() => { cbRef.current = onAppStateChange }, [onAppStateChange])

  // ── FOV helper ───────────────────────────────────────────────────────────────
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
    return {
      pose: {
        lat: c.lat, lng: c.lng,
        zoom:    map.getZoom(),
        pitch:   map.getPitch(),
        bearing: map.getBearing(),
        roll:    (map as any).getRoll?.() ?? 0,
        vfov:    map.getVerticalFieldOfView(),
      },
      numericState: appState ? extractNumbers(appState) : {},
    }
  }, [mapRef, appState])

  // ── Stop playback ─────────────────────────────────────────────────────────────
  const stopPlay = useCallback(() => {
    if (poseRafRef.current) { cancelAnimationFrame(poseRafRef.current); poseRafRef.current = null }
    setPlaying(false)
  }, [])

  // ── RAF tick ──────────────────────────────────────────────────────────────────
  const rafTick = useCallback((now: number) => {
    const p1  = p1Ref.current
    const p2  = p2Ref.current
    const map = getMap(mapRef)
    if (!p1 || !p2 || !map) { stopPlay(); return }

    const elapsed = now - playStartRef.current
    let raw = clamp(playOffsetRef.current + elapsed / durationMsRef.current, 0, 1)
    const mode = loopRef.current

    if (raw >= 1) {
      if (mode === "none") {
        applyProgress(1, p1, p2, map, appRef.current, cbRef.current, true)
        setProgress(1)
        setPlaying(false)
        poseRafRef.current = null
        return
      }
      if (mode === "forward") {
        playStartRef.current = now; playOffsetRef.current = 0; raw = 0
      }
      if (mode === "bounce") {
        bounceDir.current = bounceDir.current === 1 ? -1 : 1
        playStartRef.current = now; playOffsetRef.current = 0; raw = 0
      }
    }

    const displayRaw = bounceDir.current === 1 ? raw : 1 - raw
    applyProgress(displayRaw, p1, p2, map, appRef.current, cbRef.current, true)
    setProgress(displayRaw)

    poseRafRef.current = requestAnimationFrame(rafTick)
  }, [mapRef, stopPlay])

  // ── Start / resume playback from a given progress offset ──────────────────────
  const startPlay = useCallback((fromProgress = 0) => {
    if (!p1Ref.current || !p2Ref.current) return
    stopPlay()
    bounceDir.current     = 1
    playOffsetRef.current = clamp(fromProgress, 0, 1)
    playStartRef.current  = performance.now()
    setPlaying(true)
    poseRafRef.current = requestAnimationFrame(rafTick)
  }, [stopPlay, rafTick])

  // ── Scrub slider ──────────────────────────────────────────────────────────────
  const handleScrub = useCallback((vals: number[]) => {
    const raw = vals[0] / 100
    const p1  = p1Ref.current
    const p2  = p2Ref.current
    const map = getMap(mapRef)
    if (!p1 || !p2 || !map) return

    setProgress(raw)
    applyProgress(raw, p1, p2, map, appRef.current, cbRef.current, false)

    if (playing) {
      // Seek: reset start so animation continues from here
      playOffsetRef.current = raw
      playStartRef.current  = performance.now()
    }
  }, [playing, mapRef])





  // ── Video export ──────────────────────────────────────────────────────────────
const handleExportVideo = useCallback(async () => {
  const p1 = p1Ref.current
  const p2 = p2Ref.current
  const map = getMap(mapRef)
  const canvas = map?.getCanvas()
  
  if (!p1 || !p2 || !map || !canvas) return

  // Stop any current playback
  stopPlay()

  setExporting(true)
  setExportProgress(0)
  setExportCodec('')
  
  // Store original values
  const originalWidth = canvas.width
  const originalHeight = canvas.height
  const originalStyleWidth = canvas.style.width
  const originalStyleHeight = canvas.style.height
  const originalPixelRatio = map.getPixelRatio()

  try {
    const fps = 30
    const duration = durationMsRef.current
    
    // Calculate target dimensions maintaining aspect ratio
    const currentAspectRatio = originalWidth / originalHeight
    
    // Target 720p but maintain aspect ratio
    // let targetWidth = 1280
    // let targetHeight = 720

    let targetWidth = originalWidth
    let targetHeight = originalHeight
     
    const targetAspectRatio = targetWidth / targetHeight
    
    if (Math.abs(currentAspectRatio - targetAspectRatio) > 0.01) {
      // Adjust to match current aspect ratio
      if (currentAspectRatio > targetAspectRatio) {
        // Wider than 16:9, adjust height
        targetHeight = Math.round(targetWidth / currentAspectRatio)
      } else {
        // Taller than 16:9, adjust width
        targetWidth = Math.round(targetHeight * currentAspectRatio)
      }
    }
    
    // Ensure even dimensions (required for H.264)
    targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1
    targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1
    
    console.log('Target dimensions:', {
      original: `${originalWidth}x${originalHeight}`,
      target: `${targetWidth}x${targetHeight}`,
      originalAspect: currentAspectRatio.toFixed(3),
      targetAspect: (targetWidth / targetHeight).toFixed(3)
    })
    
    // Set pixel ratio to 1 BEFORE resize
    map.setPixelRatio(1)
    
    // Set canvas CSS size (logical pixels)
    canvas.style.width = `${targetWidth}px`
    canvas.style.height = `${targetHeight}px`
    
    // Trigger map resize - CRITICAL: this updates the map's internal state
    map.resize()
    
    // Force canvas dimensions after resize (in case map.resize changed them)
    canvas.width = targetWidth
    canvas.height = targetHeight
    
    // Trigger another resize to ensure map's transform is updated with new dimensions
    map.resize()
    
    // Wait for resize to complete
    await new Promise(resolve => requestAnimationFrame(resolve))
    await new Promise(resolve => requestAnimationFrame(resolve))
    
    // Verify and force if needed
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      console.warn('Forcing canvas dimensions:', { 
        actual: `${canvas.width}x${canvas.height}`,
        expected: `${targetWidth}x${targetHeight}`
      })
      canvas.width = targetWidth
      canvas.height = targetHeight
      map.triggerRepaint()
      await new Promise(resolve => requestAnimationFrame(resolve))
    }

    console.log('Final canvas dimensions:', {
      width: canvas.width,
      height: canvas.height,
      styleWidth: canvas.style.width,
      styleHeight: canvas.style.height,
      pixelRatio: map.getPixelRatio()
    })

    // Record frame function
    const recordFrame = async (frameIndex: number, totalFrames: number) => {
      const progress = frameIndex / totalFrames
      applyProgress(progress, p1, p2, map, appRef.current, cbRef.current, true)
    }

    // Progress callback
    const onProgress = (progress: number, codec: string) => {
      setExportProgress(progress)
      setExportCodec(codec)
    }

    // Try MediaBunny first, fall back to WebCodecs, then MediaRecorder
    let videoBlob: Blob
    let extension = 'mp4'
    
    try {
      videoBlob = await exportVideoMediaBunny(
        canvas,
        fps,
        duration,
        onProgress,
        recordFrame
      )
      extension = 'mp4'
    } catch (e) {
      console.warn('MediaBunny failed, trying WebCodecs:', e)
      try {
        videoBlob = await exportVideoWebCodecs(
          canvas,
          fps,
          duration,
          onProgress,
          recordFrame
        )
        extension = 'mp4'
      } catch (e2) {
        console.warn('WebCodecs failed, using MediaRecorder fallback:', e2)
        videoBlob = await exportVideoMediaRecorder(
          canvas,
          fps,
          duration,
          onProgress,
          recordFrame
        )
        extension = 'webm'
      }
    }

    // Download the video
    const url = URL.createObjectURL(videoBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terrain-animation-${Date.now()}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
    
  } catch (error) {
    console.error('Video export failed:', error)
    alert(`Video export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  } finally {
    // Restore original canvas size
    canvas.width = originalWidth
    canvas.height = originalHeight
    canvas.style.width = originalStyleWidth
    canvas.style.height = originalStyleHeight
    
    // Restore original pixel ratio
    map.setPixelRatio(originalPixelRatio)
    
    // Trigger resize to restore map's internal state
    map.resize()
    
    // Reset to start after resize
    await new Promise(resolve => requestAnimationFrame(resolve))
    applyProgress(0, p1, p2, map, appRef.current, cbRef.current, false)
    setProgress(0)
    
    setExporting(false)
    setExportProgress(0)
    setExportCodec('')
  }
}, [mapRef, stopPlay, setIsSidebarOpen])


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
      const delta   = spinLastRef.current !== null ? now - spinLastRef.current : 0
      spinLastRef.current = now
      spinElapsed.current += delta
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
      <Label className="text-sm font-medium">WIP Tests: Animation & ~Ortho</Label>
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

      {/* ── Pose capture ── */}
      <Label className="text-sm font-medium mt-3">
        Camera Poses{appState ? " + App State" : ""}
      </Label>

      <div className="flex gap-2">
        {/* Set Pose 1 */}
        <Button
          variant={pose1 ? "secondary" : "outline"}
          className="flex-[3] bg-transparent cursor-pointer"
          onClick={() => { const s = captureSnapshot(); if (s) setPose1(s) }}
        >
          {pose1
            ? <span className="flex items-center gap-1.5">
                {"Pose 1"} <Check className="h-4 w-4" />
              </span>
            : "Set Pose 1"}
        </Button>

        {/* Play / Stop */}
        <Button
          variant={playing ? "default" : "outline"}
          className="flex-[2] cursor-pointer"
          disabled={!canPlay || exporting}
          onClick={playing ? stopPlay : () => startPlay(progress >= 1 ? 0 : progress)}
          title={!canPlay ? "Capture both poses first" : undefined}
        >
          {playing ? (<><Pause className="h-4 w-4 mr-1" /> {"Stop"}</>) : (<><Play className="h-4 w-4 mr-1" /> {"Play"}</>)}
        </Button>

        {/* Set Pose 2 */}
        <Button
          variant={pose2 ? "secondary" : "outline"}
          className="flex-[3] bg-transparent cursor-pointer"
          onClick={() => { const s = captureSnapshot(); if (s) setPose2(s) }}
        >
          {pose2
            ? <span className="flex items-center gap-1.5">
                {"Pose 2"} <Check className="h-4 w-4" />
              </span>
            : "Set Pose 2"}
        </Button>
      </div>

      {/* ── Pose debug summary ── */}
      {(pose1 || pose2) && (
        <div className="text-xs text-muted-foreground mt-1.5 grid grid-cols-2 gap-x-2">
          {pose1 && (
            <span title={JSON.stringify(pose1.pose, null, 2)}>
              z{pose1.pose.zoom.toFixed(1)}/x{pose1.pose.lng.toFixed(2)}°/y{pose1.pose.lat.toFixed(2)}° 
              {Object.keys(pose1.numericState).length > 0
                ? ` +${Object.keys(pose1.numericState).length} vals` : ""}
            </span>
          )}
          {pose2 && (
            <span title={JSON.stringify(pose2.pose, null, 2)} className="text-right">
              z{pose2.pose.zoom.toFixed(1)}/x{pose2.pose.lng.toFixed(2)}°/y{pose2.pose.lat.toFixed(2)}° 
              {Object.keys(pose2.numericState).length > 0
                ? ` +${Object.keys(pose2.numericState).length} vals` : ""}
            </span>
          )}
        </div>
      )}

      {/* ── Timeline slider ── */}
      <div className="mt-2 flex items-center gap-2">
        {/* Current time label */}
        <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0">
          {canPlay ? `${((progress) * (durationMs / 1_000)).toFixed(1)}s` : "0.0s"}
        </span>

        <Slider
          min={0} max={100} step={0.5}
          value={[Math.round(progress * 100)]}
          onValueChange={handleScrub}
          disabled={!canPlay || exporting}
          className="flex-1 cursor-pointer"
        />

        {/* Total duration label */}
        <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0 text-right">
          {canPlay ? `${(durationMs / 1_000).toFixed(1)}s` : "--"}
        </span>
      </div>

      {/* ── Playback controls: 3-column grid ── */}
      <div className="mt-1.5 grid grid-cols-3 gap-2">

        {/* Col 1 — Duration OR Speed (single input, toggled by col 2) */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            {speedMode ? "Speed" : "Duration"}
          </Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0.1} max={speedMode ? 20 : 300} step={speedMode ? 0.1 : 0.5}
              value={speedMode ? speedMul : durationSec}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v > 0) speedMode ? setSpeedMul(v) : setDurationSec(v)
              }}
              disabled={exporting}
              className="w-full h-8 text-xs px-2"
            />
            <span className="text-xs text-muted-foreground shrink-0">
              {speedMode ? "×" : "s"}
            </span>
          </div>
        </div>

        {/* Col 2 — dur / spd switch */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Mode</Label>
          <div className="flex items-center justify-center gap-1.5 h-8">
            <span className="text-xs text-muted-foreground">dur</span>
            <Switch
              checked={speedMode}
              onCheckedChange={setSpeedMode}
              disabled={exporting}
              className="scale-[1] origin-left cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">spd</span>
          </div>
        </div>

        {/* Col 3 — Loop mode */}
        <div className="flex flex-col gap-1 h-8">
          <Label className="text-xs text-muted-foreground">Loop</Label>
          <Select value={loopMode} onValueChange={v => setLoopMode(v as LoopMode)} disabled={exporting}>
            <SelectTrigger className="h-8 text-xs w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="forward">Forward ↻</SelectItem>
              <SelectItem value="bounce">Bounce ↔</SelectItem>
            </SelectContent>
          </Select>
        </div>

      </div>

      {/* ── Video Export Button ── */}
      <div className="mt-3">
        <Button
          variant="outline"
          className="w-full cursor-pointer"
          disabled={!canPlay || exporting}
          onClick={handleExportVideo}
          title={!canPlay ? "Capture both poses first" : "Export animation as video (30fps)"}
        >
          {exporting ? (
            <>
              <Download className="h-4 w-4 mr-2 animate-pulse" />
              {exportCodec ? `Exporting via ${exportCodec}: ` : 'Exporting... '}{Math.round(exportProgress * 100)}%
            </>
          ) : (
            <>
              <Video className="h-4 w-4 mr-2" />
              Export Video
            </>
          )}
        </Button>
      </div>

    </>
  )
}
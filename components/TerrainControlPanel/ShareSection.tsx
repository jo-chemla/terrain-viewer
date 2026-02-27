import type React from "react"
import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { Share2, Check, ImageIcon, Loader2, Link, Scissors, AlertCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  SiX,
  SiBluesky,
  SiMastodon,
  SiLinkedin,
  SiThreads,
  SiReddit,
} from "react-icons/si"
import { TooltipIconButton } from "./controls-components"
import { captureMapScreenshot, copyBlobToClipboard } from "@/lib/controls-utils"

// ── config — swap these for your self-hosted Zipline or Dub.co instance ──────

const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY ?? ""
// Expiry in seconds. 600 = 10 min — plenty for all social crawlers.
const IMGBB_EXPIRY_SECONDS = 600

// Set ONE of these depending on your shortener:
const DUB_API_KEY = import.meta.env.VITE_DUB_API_KEY ?? ""
// OR for self-hosted Zipline:
// const ZIPLINE_BASE_URL = import.meta.env.VITE_ZIPLINE_BASE_URL ?? ""
// const ZIPLINE_TOKEN   = import.meta.env.VITE_ZIPLINE_TOKEN   ?? ""

// ── types ────────────────────────────────────────────────────────────────────

interface SharePlatform {
  id: string
  name: string
  icon: React.FC<{ className?: string }>
  color: string
  buildUrl: (text: string, pageUrl: string, title: string) => string
  hint?: string
}

type ShortenState =
  | { status: "idle" }
  | { status: "loading"; step: "screenshot" | "upload" | "shorten" }
  | { status: "done"; shortUrl: string }
  | { status: "error"; message: string }

// ── shared text / title ───────────────────────────────────────────────────────

const SHARE_TEXT =
  "Just used Terrain-Viewer from @iconem — an interactive terrain editor with hillshade, contours, color-relief hypso, normals & more built on top of Maplibre by @jo_chemla 🗺️\n\n"

const SHARE_TITLE = "Terrain-Viewer — interactive hillshade & terrain editor"

// ── platform definitions ──────────────────────────────────────────────────────

const PLATFORMS: SharePlatform[] = [
  {
    id: "twitter",
    name: "X / Twitter",
    icon: SiX,
    color: "#000000",
    buildUrl: (text, pageUrl) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`,
  },
  {
    id: "bluesky",
    name: "Bluesky",
    icon: SiBluesky,
    color: "#0085ff",
    buildUrl: (text, pageUrl) =>
      `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${pageUrl}`)}`,
  },
  {
    id: "mastodon",
    name: "Mastodon",
    icon: SiMastodon,
    color: "#6364ff",
    buildUrl: (text, pageUrl) =>
      `https://sharetomastodon.github.io/?title=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`,
    hint: "picks your instance",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: SiLinkedin,
    color: "#0a66c2",
    buildUrl: (_text, pageUrl) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`,
  },
  {
    id: "threads",
    name: "Threads",
    icon: SiThreads,
    color: "#000000",
    buildUrl: (text, pageUrl) =>
      `https://www.threads.net/intent/post?text=${encodeURIComponent(`${text} ${pageUrl}`)}`,
  },
  {
    id: "reddit",
    name: "Reddit",
    icon: SiReddit,
    color: "#ff4500",
    buildUrl: (text, pageUrl) =>
      `https://reddit.com/submit?type=IMAGE&title=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`,
  },
]

// ── helpers ───────────────────────────────────────────────────────────────────

/** Upload a Blob to imgbb, return the public image URL. */
async function uploadToImgbb(blob: Blob): Promise<string> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data:image/...;base64, prefix
      resolve(result.split(",")[1])
    }
    reader.onerror = () => reject(new Error("FileReader failed"))
    reader.readAsDataURL(blob)
  })

  const form = new FormData()
  form.append("image", base64)
  form.append("expiration", String(IMGBB_EXPIRY_SECONDS))

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: form,
  })
  const data = await res.json()
  if (!data.success) throw new Error(`imgbb upload failed: ${data?.error?.message ?? "unknown"}`)
  return data.data.url as string
}

/** Shorten a URL via Dub.co, optionally attaching an OG image URL. */
async function shortenWithDub(destinationUrl: string, imageUrl?: string): Promise<string> {
  const body: Record<string, string> = { url: destinationUrl }
  if (imageUrl) {
    body.image = imageUrl
    body.title = SHARE_TITLE
    body.description = SHARE_TEXT.trim()
  }

  const res = await fetch("https://api.dub.co/links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DUB_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Dub.co error: ${data?.error?.message ?? res.statusText}`)
  return data.shortLink as string
}

// ── CopyUrlButton ─────────────────────────────────────────────────────────────

const CopyUrlButton: React.FC<{ pageUrl: string }> = ({ pageUrl }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pageUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard denied
    }
  }, [pageUrl])

  return (
    <button
      onClick={handleCopy}
      className="
        flex items-center justify-center gap-2 w-full rounded-md px-3 py-2
        border border-border bg-background hover:bg-muted/40
        text-xs font-medium transition-colors duration-150 cursor-pointer
      "
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
          <span className="text-green-400">URL copied!</span>
        </>
      ) : (
        <>
          <Link className="h-3.5 w-3.5 shrink-0" />
          Copy URL to clipboard
        </>
      )}
    </button>
  )
}

// ── ShortenToggle ─────────────────────────────────────────────────────────────

const SHORTEN_STORAGE_KEY = "terrain-viewer:shorten-urls"

const ShortenToggle: React.FC<{
  enabled: boolean
  onChange: (v: boolean) => void
  state: ShortenState
}> = ({ enabled, onChange, state }) => {
  const stepLabel: Record<string, string> = {
    screenshot: "Capturing…",
    upload: "Uploading image…",
    shorten: "Shortening…",
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <Scissors className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Label
          htmlFor="shorten-toggle"
          className="text-xs font-medium cursor-pointer select-none"
        >
          Shorten URL + attach OG image
        </Label>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {state.status === "loading" && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {stepLabel[state.step]}
          </span>
        )}
        {state.status === "error" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertCircle className="h-3.5 w-3.5 text-destructive cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px] text-xs">
              {state.message}
            </TooltipContent>
          </Tooltip>
        )}
        <Switch
          id="shorten-toggle"
          checked={enabled}
          onCheckedChange={onChange}
          disabled={state.status === "loading"}
        />
      </div>
    </div>
  )
}

// ── ShortUrlDisplay ───────────────────────────────────────────────────────────

const ShortUrlDisplay: React.FC<{ shortUrl: string }> = ({ shortUrl }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shortUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // denied
    }
  }, [shortUrl])

  return (
    <button
      onClick={handleCopy}
      className="
        flex items-center justify-between gap-2 w-full rounded-md px-3 py-2
        border border-green-500/40 bg-green-500/10 hover:bg-green-500/20
        text-xs font-medium transition-colors duration-150 cursor-pointer
      "
    >
      <span className="truncate text-green-400 font-mono">{shortUrl}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
      ) : (
        <Link className="h-3.5 w-3.5 text-green-400 shrink-0" />
      )}
    </button>
  )
}

// ── ShareModal ────────────────────────────────────────────────────────────────

const ShareModal: React.FC<{
  open: boolean
  onOpenChange: (v: boolean) => void
  mapRef?: React.RefObject<any>
}> = ({ open, onOpenChange, mapRef }) => {
  const [imageCopied, setImageCopied] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [isLoadingImage, setIsLoadingImage] = useState(false)

  // Shorten toggle — persisted to localStorage
  const [shortenEnabled, setShortenEnabled] = useState(() => {
    try {
      return localStorage.getItem(SHORTEN_STORAGE_KEY) === "true"
    } catch {
      return false
    }
  })

  const [shortenState, setShortenState] = useState<ShortenState>({ status: "idle" })

  // Cache the Blob so canvas is only encoded once per modal session
  const cachedBlobRef = useRef<Blob | null>(null)
  // Cache the short URL so we don't re-shorten on re-render
  const cachedShortUrlRef = useRef<string | null>(null)

  const pageUrl = typeof window !== "undefined" ? window.location.href : ""

  const platformUrls = useMemo(() => {
    // If we have a short URL, use it for intent links; otherwise fall back to pageUrl
    const urlToShare =
      shortenEnabled && shortenState.status === "done" ? shortenState.shortUrl : pageUrl
    return Object.fromEntries(
      PLATFORMS.map((p) => [p.id, p.buildUrl(SHARE_TEXT, urlToShare, SHARE_TITLE)])
    )
  }, [pageUrl, shortenEnabled, shortenState])

  // ── shorten toggle handler ──────────────────────────────────────────────────

  const handleShortenToggle = useCallback(
    (enabled: boolean) => {
      setShortenEnabled(enabled)
      try {
        localStorage.setItem(SHORTEN_STORAGE_KEY, String(enabled))
      } catch {}

      // Reset shorten state when toggled off
      if (!enabled) {
        setShortenState({ status: "idle" })
        cachedShortUrlRef.current = null
        return
      }

      // If already done (cached), no need to re-run
      if (cachedShortUrlRef.current) {
        setShortenState({ status: "done", shortUrl: cachedShortUrlRef.current })
        return
      }

      // Kick off the full pipeline
      runShortenPipeline()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapRef, pageUrl]
  )

  // Run automatically when the modal opens if shorten was already enabled
  useEffect(() => {
    if (open && shortenEnabled && shortenState.status === "idle" && !cachedShortUrlRef.current) {
      runShortenPipeline()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const getOrCreateBlob = useCallback(async (): Promise<Blob | null> => {
    if (cachedBlobRef.current) return cachedBlobRef.current
    if (!mapRef?.current) return null
    const blob = await captureMapScreenshot(mapRef, "png")
    if (blob) cachedBlobRef.current = blob
    return blob
  }, [mapRef])

  const runShortenPipeline = useCallback(async () => {
    setShortenState({ status: "loading", step: "screenshot" })
    try {
      // 1. Capture screenshot
      const blob = await getOrCreateBlob()

      let imageUrl: string | undefined
      if (blob && IMGBB_API_KEY) {
        // 2. Upload to imgbb
        setShortenState({ status: "loading", step: "upload" })
        imageUrl = await uploadToImgbb(blob)
      }

      // 3. Shorten with Dub.co (attaching OG image if we have one)
      setShortenState({ status: "loading", step: "shorten" })
      const shortUrl = await shortenWithDub(pageUrl, imageUrl)

      cachedShortUrlRef.current = shortUrl
      setShortenState({ status: "done", shortUrl })
    } catch (err: any) {
      setShortenState({ status: "error", message: err?.message ?? "Unknown error" })
    }
  }, [getOrCreateBlob, pageUrl])

  // ── native share ────────────────────────────────────────────────────────────

  const [canNativeShare, setCanNativeShare] = useState(false)
  useEffect(() => {
    setCanNativeShare(!!navigator?.share)
  }, [])

  const handleNativeShare = useCallback(async () => {
    const urlToShare =
      shortenEnabled && shortenState.status === "done" ? shortenState.shortUrl : pageUrl
    try {
      const blob = await getOrCreateBlob()
      if (
        blob &&
        navigator.canShare?.({
          files: [new File([blob], "terrain-view.png", { type: blob.type })],
        })
      ) {
        await navigator.share({
          title: SHARE_TITLE,
          text: SHARE_TEXT,
          url: urlToShare,
          files: [new File([blob], "terrain-view.png", { type: blob.type })],
        })
      } else {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: urlToShare })
      }
    } catch {
      // user cancelled
    }
  }, [getOrCreateBlob, pageUrl, shortenEnabled, shortenState])

  // ── copy image ──────────────────────────────────────────────────────────────

  const copyImage = useCallback(async (): Promise<boolean> => {
    setIsLoadingImage(true)
    try {
      const blob = await getOrCreateBlob()
      if (!blob) { setImageError(true); return false }
      await copyBlobToClipboard(blob)
      setImageCopied(true)
      setImageError(false)
      return true
    } catch (error) {
      console.error("Failed to copy image:", error)
      setImageError(true)
      return false
    } finally {
      setIsLoadingImage(false)
    }
  }, [getOrCreateBlob])

  const handlePlatformMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      copyImage().catch(() => {})
    },
    [copyImage]
  )

  // ── modal close ─────────────────────────────────────────────────────────────

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) {
        cachedBlobRef.current = null
        cachedShortUrlRef.current = null
        setImageCopied(false)
        setImageError(false)
        setIsLoadingImage(false)
        setShortenState({ status: "idle" })
      }
      onOpenChange(v)
    },
    [onOpenChange]
  )

  // ── active URL for copy button ──────────────────────────────────────────────

  const activeUrl =
    shortenEnabled && shortenState.status === "done" ? shortenState.shortUrl : pageUrl

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm bg-background border border-border [&>button]:cursor-pointer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4" />
            Share this view
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Shares the current URL with all your map settings. Click a platform to open its
            composer. Your screenshot is copied to clipboard automatically — press{" "}
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono border border-border">
              Ctrl+V
            </kbd>
            {" / "}
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono border border-border">
              ⌘V
            </kbd>{" "}
            to paste before publishing.
          </DialogDescription>
        </DialogHeader>

        {/* ── Shorten toggle (top of modal body) ── */}
        {/* <ShortenToggle
          enabled={shortenEnabled}
          onChange={handleShortenToggle}
          state={shortenState}
        /> */}

        {/* Short URL display when ready */}
        {/* {shortenEnabled && shortenState.status === "done" && (
          <ShortUrlDisplay shortUrl={shortenState.shortUrl} />
        )} */}

        {/* Error hint */}
        {/* {shortenEnabled && shortenState.status === "error" && (
          <p className="text-[10px] text-destructive px-1">
            ⚠ Could not shorten URL — using full URL instead. Check your API keys.
          </p>
        )} */}

        {/* ── 3×3 platform grid ── */}
        <div className="grid grid-cols-3 gap-1.5">
          {PLATFORMS.map((platform) => {
            const Icon = platform.icon
            return (
              <a
                key={platform.id}
                href={platformUrls[platform.id]}
                target="_blank"
                rel="noopener noreferrer"
                onMouseDown={handlePlatformMouseDown}
                title={platform.hint ? `${platform.name} — ${platform.hint}` : platform.name}
                className="
                  group flex flex-col items-center justify-center gap-1.5
                  rounded-md px-2 py-3
                  border border-border hover:border-border/60
                  bg-background hover:bg-muted/40
                  transition-all duration-150 cursor-pointer no-underline
                "
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md transition-transform group-hover:scale-110">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors leading-tight text-center">
                  {platform.name}
                </span>
              </a>
            )
          })}
        </div>

        <div className="flex flex-col gap-1">
          {/* Native mobile share */}
          {canNativeShare && (
            <button
              onClick={handleNativeShare}
              className="
                flex items-center justify-center gap-2 w-full rounded-md px-3 py-2
                border border-border bg-background hover:bg-muted/40
                text-xs font-medium transition-colors duration-150 cursor-pointer
              "
            >
              <Share2 className="h-3.5 w-3.5 shrink-0" />
              Native Share (for apps like WhatsApp, Slack...)
            </button>
          )}

          <p className="text-xs text-muted-foreground mt-2">Or Copy Snapshot and URL yourself</p>

          {/* Copy image */}
          <button
            onClick={copyImage}
            disabled={isLoadingImage}
            className="
              flex items-center justify-center gap-2 w-full rounded-md px-3 py-2
              border border-border bg-background hover:bg-muted/40
              text-xs font-medium transition-colors duration-150 cursor-pointer
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {isLoadingImage ? (
              <>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>Capturing screenshot…</span>
              </>
            ) : imageCopied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                <span className="text-green-400">Screenshot copied — paste with Ctrl+V / ⌘V</span>
              </>
            ) : imageError ? (
              <>
                <ImageIcon className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-destructive">Clipboard access denied</span>
              </>
            ) : (
              <>
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                Copy screenshot to clipboard
              </>
            )}
          </button>

          <CopyUrlButton pageUrl={activeUrl} />
        </div>

        {/* Text preview */}
        <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-foreground/80 leading-relaxed">
          {SHARE_TEXT}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── ShareButton (drop-in for DownloadSection) ─────────────────────────────────

export const ShareButton: React.FC<{
  mapRef?: React.RefObject<any>
}> = ({ mapRef }) => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <TooltipIconButton
        icon={Share2}
        tooltip="Share to social media"
        onClick={() => setOpen(true)}
        variant="outline"
        className="flex-1 bg-transparent"
      />
      <ShareModal open={open} onOpenChange={setOpen} mapRef={mapRef} />
    </>
  )
}
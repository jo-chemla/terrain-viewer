import type React from "react"
import { useState, useCallback, useRef, useMemo } from "react"
import { Share2, Check, ImageIcon, Loader2 } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  SiX,
  SiBluesky,
  SiMastodon,
  SiLinkedin,
  SiThreads,
  SiReddit,
} from "react-icons/si"
import { TooltipIconButton } from "./controls-components"
// import { captureMapScreenshot, copyBlobToClipboard } from "@/lib/map-canvas-utils"
import { captureMapScreenshot, copyBlobToClipboard } from "@/lib/controls-utils"

// ── types ────────────────────────────────────────────────────────────────────

interface SharePlatform {
  id: string
  name: string
  icon: React.FC<{ className?: string }>
  color: string
  /** Receives the display text (no URL), the full current page URL, and a short title */
  buildUrl: (text: string, pageUrl: string, title: string) => string
  hint?: string
}

// ── shared text / title ───────────────────────────────────────────────────────

// Display text (shown in preview box, no URL appended here)
const SHARE_TEXT =
  "Just used Terrain-Viewer from @iconem — an interactive terrain editor with hillshade, contours, color-relief hypso, normals & more built on top of Maplibre by @jo_chemla 🗺️\n\n"

// Short title for platforms that only take a title (HN ≤ ~60 chars)
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
    // Pure static GH-Pages redirector — prompts for instance, no server tracking
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
    // Reddit: title + url; the link appears as submission URL (user can add text body after)
    buildUrl: (text, pageUrl) =>
      `https://reddit.com/submit?type=IMAGE&title=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`,
  },
]

// ── ShareModal ────────────────────────────────────────────────────────────────

const ShareModal: React.FC<{
  open: boolean
  onOpenChange: (v: boolean) => void
  mapRef?: React.RefObject<any>
}> = ({ open, onOpenChange, mapRef }) => {
  const [imageCopied, setImageCopied] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [isLoadingImage, setIsLoadingImage] = useState(false)

  // Cache the Blob so canvas is only encoded once per modal session
  const cachedBlobRef = useRef<Blob | null>(null)

  // Build all intent URLs using the real current page URL (including query string)
  const pageUrl = typeof window !== "undefined" ? window.location.href : ""

  const platformUrls = useMemo(
    () =>
      Object.fromEntries(
        PLATFORMS.map((p) => [p.id, p.buildUrl(SHARE_TEXT, pageUrl, SHARE_TITLE)])
      ),
    [pageUrl]
  )

  const getOrCreateBlob = useCallback(async (): Promise<Blob | null> => {
    if (cachedBlobRef.current) return cachedBlobRef.current
    if (!mapRef?.current) return null
    
    // Use JPEG for faster encoding and smaller size (social media will recompress anyway)
    const blob = await captureMapScreenshot(mapRef, "png")
    if (blob) {
      cachedBlobRef.current = blob
    }
    return blob
  }, [mapRef])

  const handleOpenChange = useCallback(
    (v: boolean) => {
      if (!v) {
        cachedBlobRef.current = null
        setImageCopied(false)
        setImageError(false)
        setIsLoadingImage(false)
      }
      onOpenChange(v)
    },
    [onOpenChange]
  )

  // Copy image to clipboard — called by the explicit "Copy image" button AND
  // automatically before opening an intent link
  const copyImage = useCallback(async (): Promise<boolean> => {
    setIsLoadingImage(true)
    try {
      const blob = await getOrCreateBlob()
      if (!blob) {
        setImageError(true)
        return false
      }
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

  // Called when user clicks a platform <a> — copy image first, then let the
  // href navigate normally (middle-click / ctrl+click still works naturally)
  const handlePlatformMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only intercept left-click (button === 0); middle/right clicks open naturally
      if (e.button !== 0) return
      // Copy image in background — don't block navigation
      copyImage().catch(() => {})
    },
    [copyImage]
  )

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

        {/* ── Copy image button (primary action) ── */}
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
              <span>Capturing screenshot...</span>
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

        {/* text preview */}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <TooltipIconButton
            icon={Share2}
            tooltip="Share to Socials"
            onClick={() => setOpen(true)}
            variant="outline"
            className="flex-1 bg-transparent"
          />
        </TooltipTrigger>
        <TooltipContent>
          <p>Share to social media</p>
        </TooltipContent>
      </Tooltip>

      <ShareModal open={open} onOpenChange={setOpen} mapRef={mapRef} />
    </>
  )
}
// The Share dialog's "Save view" box (beta, Settings → Beta): sign in with an
// AT Protocol account, write the current view as one record of that account,
// get a short link. Loaded on demand (React.lazy in ShareSection.tsx), so
// neither this file nor lib/view-sharing.ts is in the app's first load.
import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { Bookmark, Check, Link, Loader2, LogOut } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { pushToast } from "@/components/ui/toast"
import { track } from "@/lib/analytics"
import { maskedParamKeys, saveView, session as readSession, signIn, signInUnavailableReason, signOut, type SaveViewResult, type ViewSession } from "@/lib/view-sharing"

const HANDLE_STORAGE_KEY = "tv-atproto-last-handle"
const THUMBNAIL_MAX_PX = 1200

/** The snapshot as a JPEG no wider or taller than 1200 px: about 150 KB,
 *  well under any server's blob limit, enough for a link preview. */
async function toThumbnail(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, THUMBNAIL_MAX_PX / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be encoded"))), "image/jpeg", 0.82))
}

const button = "flex items-center justify-center gap-2 rounded-md px-3 py-2 border border-border bg-background hover:bg-muted/40 text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"

const SavedViewPanel: React.FC<{
  /** The link the record stands for (the Share dialog's, sources by URL). */
  pageUrl: string
  /** The dialog's snapshot of the map, or null when there is none. */
  getSnapshot: () => Promise<Blob | null>
}> = ({ pageUrl, getSnapshot }) => {
  const [account, setAccount] = useState<ViewSession | null>(() => readSession())
  const [handle, setHandle] = useState(() => { try { return localStorage.getItem(HANDLE_STORAGE_KEY) ?? "" } catch { return "" } })
  const [title, setTitle] = useState("")
  const [withPicture, setWithPicture] = useState(true)
  const [busy, setBusy] = useState<null | "sign-in" | "picture" | "save">(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SaveViewResult | null>(null)
  const [copied, setCopied] = useState(false)
  const unavailable = signInUnavailableReason()

  // A view saved for one address is not the view of another.
  useEffect(() => { setSaved(null) }, [pageUrl])

  const handleSignIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy("sign-in")
    try {
      try { localStorage.setItem(HANDLE_STORAGE_KEY, handle.trim()) } catch { /* storage blocked */ }
      track("actions-share", { kind: "atproto-sign-in" })
      await signIn(handle) // leaves the page
    } catch (err) {
      setError((err as Error)?.message ?? "Sign-in failed")
      setBusy(null)
    }
  }, [handle])

  const handleSignOut = useCallback(async () => {
    setAccount(null)
    setSaved(null)
    await signOut()
  }, [])

  const search = (() => { try { return new URL(pageUrl).search } catch { return "" } })()
  const masked = maskedParamKeys(search)

  const handleSave = useCallback(async () => {
    setError(null)
    setSaved(null)
    try {
      let thumbnail: Blob | null = null
      if (withPicture) {
        setBusy("picture")
        try {
          const snapshot = await getSnapshot()
          if (snapshot) thumbnail = await toThumbnail(snapshot)
        } catch (err) {
          console.warn("[saved view] no picture:", err)
        }
      }
      setBusy("save")
      const result = await saveView(search, { title, thumbnail, pageHref: pageUrl })
      setSaved(result)
      track("actions-share", { kind: "atproto-save" })
    } catch (err) {
      setError((err as Error)?.message ?? "The view could not be saved")
      setAccount(readSession())
    } finally {
      setBusy(null)
    }
  }, [getSnapshot, pageUrl, search, title, withPicture])

  const handleCopy = useCallback(async () => {
    if (!saved) return
    try {
      await navigator.clipboard.writeText(saved.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      pushToast({ key: "clipboard", tone: "alert", title: "Could not copy to the clipboard", body: "Select the link and copy it by hand." })
    }
  }, [saved])

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <Bookmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">Save view, short link</span>
        <span className="text-[10px] text-muted-foreground shrink-0">beta</span>
      </div>

      {!account && unavailable && <p className="text-[10px] text-muted-foreground break-words">{unavailable}</p>}

      {!account && !unavailable && (
        <form onSubmit={handleSignIn} className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground break-words">
            Sign in with a Bluesky or other AT Protocol account: the view is stored as one public record of your own account, and anyone opens its short link without signing in.
          </p>
          <div className="flex items-center gap-2 min-w-0">
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="alice.bsky.social"
              aria-label="Your handle"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="h-8 text-xs flex-1 min-w-0"
            />
            <button type="submit" disabled={!handle.trim() || busy !== null} className={`${button} shrink-0`}>
              {busy === "sign-in" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Sign in
            </button>
          </div>
        </form>
      )}

      {account && (
        <>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-[11px] text-muted-foreground truncate" title={account.did}>Signed in as <span className="text-foreground font-medium">{account.handle ? `@${account.handle}` : account.did}</span></span>
            <button onClick={handleSignOut} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer shrink-0">
              <LogOut className="h-3 w-3" />Sign out
            </button>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title of the saved view" maxLength={300} className="h-8 text-xs flex-1 min-w-0" />
            <button onClick={handleSave} disabled={busy !== null} className={`${button} shrink-0`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
              {busy === "picture" ? "Capturing…" : busy === "save" ? "Saving…" : "Save view"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="saved-view-picture" className="text-[11px] text-muted-foreground cursor-pointer">Include a picture of the map</Label>
            <Switch id="saved-view-picture" checked={withPicture} onCheckedChange={setWithPicture} className="cursor-pointer" />
          </div>
          <p className="text-[10px] text-muted-foreground break-words">The record is public, like a post. API keys are never part of it.</p>
          {masked.length > 0 && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400 break-words">
              A key inside a source address ({masked.join(", ")}) is replaced by a placeholder in the record: that source will not load for other people.
            </p>
          )}
        </>
      )}

      {saved && (
        <>
          <button onClick={handleCopy} className="flex items-center justify-between gap-2 w-full min-w-0 rounded-md px-3 py-2 border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 text-xs font-medium transition-colors duration-150 cursor-pointer">
            <span className="truncate text-green-600 dark:text-green-400 font-mono" title={saved.link}>{saved.link}</span>
            {copied ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" /> : <Link className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />}
          </button>
          {saved.thumbnailError && <p className="text-[10px] text-muted-foreground break-words">Saved without its picture: {saved.thumbnailError}</p>}
        </>
      )}

      {error && <p className="text-[10px] text-destructive break-words">{error}</p>}
    </div>
  )
}

export default SavedViewPanel

// The Share dialog's "Save view" box (beta, Settings → Beta): sign in with an
// AT Protocol account, write the current view as one record of that account,
// get a short link; list the account's saved views, open, copy or delete
// one; and, only on an explicit click, publish one as a Bluesky post whose
// card is the view's own picture. Loaded on demand (React.lazy in
// ShareSection.tsx), so neither this file nor lib/view-sharing.ts is in the
// app's first load.
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Bookmark, Check, ExternalLink, Link, List, Loader2, LogOut, RefreshCw, Send, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { pushToast } from "@/components/ui/toast"
import { track } from "@/lib/analytics"
import {
  POST_MAX_GRAPHEMES, allowPosting, canPost, clearPostDraft, deleteView, graphemeLength, listViews, maskedParamKeys, pendingPostDraft, postView,
  saveView, session as readSession, signIn, signInUnavailableReason, signOut,
  type PostDraft, type SavedViewList, type ViewSession,
} from "@/lib/view-sharing"

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
const iconButton = "flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"

const MODE_LABELS: Record<string, string> = { terrain: "Terrain", historical: "Historical imagery", rem: "River REM", georef: "Georeferencer" }

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    pushToast({ key: "clipboard", tone: "alert", title: "Could not copy to the clipboard", body: "Select the link and copy it by hand." })
    return false
  }
}

type Draft = Omit<PostDraft, "did">

/** The list of an account's saved views. `own` adds Post and Delete. */
const ViewList: React.FC<{
  list: SavedViewList
  own: boolean
  onDeleted: (rkey: string) => void
  onPost: (draft: Draft) => void
}> = ({ list, own, onDeleted, onPost }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = useCallback(async (rkey: string) => {
    setError(null)
    setDeleting(rkey)
    try {
      await deleteView({ repo: list.did, rkey })
      track("actions-share", { kind: "atproto-delete" })
      onDeleted(rkey)
    } catch (err) {
      setError((err as Error)?.message ?? "The view could not be deleted")
    } finally {
      setDeleting(null)
      setConfirming(null)
    }
  }, [list.did, onDeleted])

  if (list.views.length === 0) return <p className="text-[10px] text-muted-foreground">No saved view yet.</p>
  return (
    <>
      <ul className="space-y-1 max-h-56 overflow-y-auto min-w-0" aria-label="Saved views">
        {list.views.map((v) => {
          const rkey = v.ref.rkey
          const mode = typeof v.record.params.appMode === "string" ? MODE_LABELS[v.record.params.appMode] : undefined
          return (
            <li key={rkey} className="flex items-center gap-2 min-w-0 rounded-md border border-border/60 bg-background/60 px-1.5 py-1">
              {v.thumbnailUrl
                ? <img src={v.thumbnailUrl} alt="" loading="lazy" className="h-8 w-12 rounded-sm object-cover bg-muted shrink-0" />
                : <span className="h-8 w-12 rounded-sm bg-muted shrink-0" aria-hidden />}
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-medium truncate" title={v.record.title}>{v.record.title}</span>
                <span className="block text-[10px] text-muted-foreground truncate">{[formatDate(v.record.createdAt), mode].filter(Boolean).join(" · ")}</span>
              </span>
              {confirming === rkey ? (
                <span className="flex items-center gap-1 shrink-0 text-[10px]">
                  <span className="text-muted-foreground">Delete?</span>
                  <button onClick={() => remove(rkey)} disabled={deleting !== null} className="rounded px-1.5 py-0.5 border border-destructive/50 text-destructive hover:bg-destructive/10 cursor-pointer disabled:opacity-50">
                    {deleting === rkey ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                  </button>
                  <button onClick={() => setConfirming(null)} disabled={deleting !== null} className="rounded px-1.5 py-0.5 border border-border hover:bg-muted/60 cursor-pointer">Keep</button>
                </span>
              ) : (
                <span className="flex items-center gap-0.5 shrink-0">
                  <a href={v.link} className={iconButton} title="Open this view" aria-label={`Open ${v.record.title}`}><ExternalLink className="h-3.5 w-3.5" /></a>
                  <button
                    className={iconButton} title="Copy its short link" aria-label={`Copy the link of ${v.record.title}`}
                    onClick={async () => { if (await copyText(v.link)) { setCopiedKey(rkey); setTimeout(() => setCopiedKey((k) => (k === rkey ? null : k)), 2000) } }}
                  >
                    {copiedKey === rkey ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <Link className="h-3.5 w-3.5" />}
                  </button>
                  {own && (
                    <>
                      <button className={iconButton} title="Post to Bluesky… (opens an editor, posts nothing by itself)" aria-label={`Post ${v.record.title} to Bluesky`} onClick={() => onPost({ link: v.link, title: v.record.title, thumbnail: v.record.thumbnail, previewUrl: v.thumbnailUrl })}>
                        <Send className="h-3.5 w-3.5" />
                      </button>
                      <button className={iconButton} title="Delete this view" aria-label={`Delete ${v.record.title}`} onClick={() => setConfirming(rkey)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="text-[10px] text-destructive break-words">{error}</p>}
    </>
  )
}

/** The editor of a post: the text is the user's to change, and nothing is
 *  published before Post is pressed. Where the sign-in does not hold the
 *  permission to post, the button asks the account's server for it first. */
const PostEditor: React.FC<{ draft: Draft; onClose: () => void }> = ({ draft, onClose }) => {
  const [text, setText] = useState(() => `${draft.title && draft.title !== "Untitled view" ? `${draft.title}\n` : ""}${draft.link}`)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState<string | null>(null)
  const length = graphemeLength(text.trim())

  useEffect(() => {
    let live = true
    canPost().then((ok) => { if (live) setAllowed(ok) }, () => { if (live) setAllowed(false) })
    return () => { live = false }
  }, [])

  const allow = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      track("actions-share", { kind: "atproto-allow-posting" })
      await allowPosting(draft) // leaves the page
    } catch (err) {
      setError((err as Error)?.message ?? "The permission could not be asked for")
      setBusy(false)
    }
  }, [draft])

  const post = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const out = await postView({ text, link: draft.link, title: draft.title, description: "A map view saved in Terrain Viewer. Opens in the browser, nothing to install.", thumbnail: draft.thumbnail })
      track("actions-share", { kind: "atproto-post" })
      setPosted(out.url)
    } catch (err) {
      setError((err as Error)?.message ?? "The post could not be published")
    } finally {
      setBusy(false)
    }
  }, [draft, text])

  const close = () => { clearPostDraft(); onClose() }

  return (
    <div className="rounded-md border border-border bg-background/70 px-2 py-2 space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-[11px] font-medium truncate">Post to Bluesky</span>
        <button onClick={close} className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer shrink-0">{posted ? "Close" : "Cancel"}</button>
      </div>
      {posted ? (
        <p className="text-[11px] break-words">
          Posted. <a href={posted} target="_blank" rel="noreferrer" className="underline">See the post</a>
        </p>
      ) : (
        <>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Text of the post" rows={3} className="text-xs md:text-xs min-h-14 px-2 py-1.5" />
          <div className="flex items-center gap-2 min-w-0 rounded-md border border-border/60 px-1.5 py-1">
            {draft.previewUrl
              ? <img src={draft.previewUrl} alt="" className="h-8 w-12 rounded-sm object-cover bg-muted shrink-0" />
              : <span className="h-8 w-12 rounded-sm bg-muted shrink-0" aria-hidden />}
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-medium truncate">{draft.title}</span>
              <span className="block text-[10px] text-muted-foreground truncate">The post's card{draft.thumbnail ? ", with the view's picture" : " (this view has no picture)"}</span>
            </span>
          </div>
          {allowed === false && (
            <p className="text-[10px] text-muted-foreground break-words">
              Posting needs one more permission than saving: creating a post, nothing else of your account. Your server asks you to accept it, then this editor comes back. Nothing is posted until you press Post.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[10px] ${length > POST_MAX_GRAPHEMES ? "text-destructive" : "text-muted-foreground"}`}>{length} / {POST_MAX_GRAPHEMES}</span>
            {allowed === false ? (
              <button onClick={allow} disabled={busy} className={button}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Allow posting…
              </button>
            ) : (
              <button onClick={post} disabled={busy || allowed === null || length === 0 || length > POST_MAX_GRAPHEMES} className={button}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Post
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="text-[10px] text-destructive break-words">{error}</p>}
    </div>
  )
}

const SavedViewPanel: React.FC<{
  /** The address of the view (the Share dialog's, sources by URL). */
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
  const [saved, setSaved] = useState<(Draft & { thumbnailError?: string }) | null>(null)
  const [copied, setCopied] = useState(false)
  const [list, setList] = useState<SavedViewList | null>(null)
  const [listOf, setListOf] = useState<string | null>(null)
  const [listBusy, setListBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  // A view on its way to a post: from the redirect back, or from a click.
  const [draft, setDraft] = useState<Draft | null>(() => pendingPostDraft())
  const previewUrl = useRef<string | null>(null)
  const unavailable = signInUnavailableReason()

  // A view saved for one address is not the view of another.
  useEffect(() => { setSaved(null) }, [pageUrl])
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current) }, [])

  const loadList = useCallback(async (who?: string) => {
    setListError(null)
    setListBusy(true)
    try {
      setList(await listViews(who))
      setListOf(who ?? null)
    } catch (err) {
      setList(null)
      setListError((err as Error)?.message ?? "The list could not be read")
    } finally {
      setListBusy(false)
    }
  }, [])

  const did = account?.did
  useEffect(() => { if (did) void loadList() }, [did, loadList])

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
    setList(null)
    setDraft(null)
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
      const result = await saveView({ title, thumbnail, pageHref: pageUrl })
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = thumbnail && result.thumbnail ? URL.createObjectURL(thumbnail) : null
      setSaved({ link: result.link, title: result.title, thumbnail: result.thumbnail, previewUrl: previewUrl.current ?? undefined, thumbnailError: result.thumbnailError })
      track("actions-share", { kind: "atproto-save" })
      void loadList()
    } catch (err) {
      setError((err as Error)?.message ?? "The view could not be saved")
      setAccount(readSession())
    } finally {
      setBusy(null)
    }
  }, [getSnapshot, loadList, pageUrl, title, withPicture])

  const handleCopy = useCallback(async () => {
    if (!saved || !(await copyText(saved.link))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [saved])

  const onDeleted = useCallback((rkey: string) => {
    setList((l) => (l ? { ...l, views: l.views.filter((v) => v.ref.rkey !== rkey) } : l))
    setSaved((s) => (s && s.link.endsWith(`/${rkey}`) ? null : s))
  }, [])

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <Bookmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">Save view, short link</span>
        <span className="text-[10px] text-muted-foreground shrink-0">beta</span>
      </div>

      {!account && unavailable && <p className="text-[10px] text-muted-foreground break-words">{unavailable}</p>}

      {!account && (
        <form onSubmit={handleSignIn} className="space-y-1.5">
          {!unavailable && (
            <p className="text-[10px] text-muted-foreground break-words">
              Sign in with a Bluesky or other AT Protocol account: the view is stored as one public record of your own account, and anyone opens its short link without signing in.
            </p>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="alice.bsky.social"
              aria-label="A handle"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="h-8 text-xs flex-1 min-w-0"
            />
            {!unavailable && (
              <button type="submit" disabled={!handle.trim() || busy !== null} className={`${button} shrink-0`}>
                {busy === "sign-in" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Sign in
              </button>
            )}
            <button type="button" onClick={() => loadList(handle.trim())} disabled={!handle.trim() || listBusy} className={`${button} shrink-0`} title="The saved views of this account: public, no sign-in needed">
              {listBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <List className="h-3.5 w-3.5" />}
              Views
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
          <p className="text-[10px] text-muted-foreground break-words">Public, but not posted to your feed: a record on your own server that anyone with its address can read. API keys are never part of it.</p>
          {masked.length > 0 && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400 break-words">
              A key inside a source address ({masked.join(", ")}) is replaced by a placeholder in the record: that source will not load for other people.
            </p>
          )}
        </>
      )}

      {saved && (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={handleCopy} className="flex flex-1 items-center justify-between gap-2 min-w-0 rounded-md px-3 py-2 border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 text-xs font-medium transition-colors duration-150 cursor-pointer">
              <span className="truncate text-green-600 dark:text-green-400 font-mono" title={saved.link}>{saved.link}</span>
              {copied ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" /> : <Link className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />}
            </button>
            <button onClick={() => setDraft(saved)} className={`${button} shrink-0`} title="Opens an editor: nothing is posted until you press Post">
              <Send className="h-3.5 w-3.5" />Post…
            </button>
          </div>
          {saved.thumbnailError && <p className="text-[10px] text-muted-foreground break-words">Saved without its picture: {saved.thumbnailError}</p>}
        </>
      )}

      {account && draft && <PostEditor key={draft.link} draft={draft} onClose={() => setDraft(null)} />}

      {(list || listBusy || listError) && (
        <div className="space-y-1 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-[11px] text-muted-foreground truncate">{account ? "Your saved views" : `Saved views of ${listOf ?? handle.trim()}`}</span>
            {account && (
              <button onClick={() => loadList()} disabled={listBusy} className={iconButton} title="Read the list again" aria-label="Read the list again">
                {listBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {list && <ViewList list={list} own={!!account && list.did === account.did} onDeleted={onDeleted} onPost={setDraft} />}
          {listError && <p className="text-[10px] text-destructive break-words">{listError}</p>}
        </div>
      )}

      {error && <p className="text-[10px] text-destructive break-words">{error}</p>}
    </div>
  )
}

export default SavedViewPanel

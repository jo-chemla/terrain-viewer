import type React from "react"
import { useEffect, useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

/** A deliberately tiny toast. The app had no notification primitive at all and
 *  pulling in sonner for one message would be a dependency for a div.
 *
 *  Backed by a plain module-level store rather than a jotai atom, because most
 *  of what is worth toasting happens OUTSIDE React: a protocol handler
 *  rejecting, a geocoder control's own event listener, a clipboard write
 *  failing in a callback. A hook-only API would have meant plumbing a setter
 *  into each of those.
 *
 *  Messages are keyed: firing the same key again replaces it and restarts its
 *  timer instead of stacking a duplicate, which is what you want when the same
 *  failing thing happens once per tile. */
export interface Toast {
  key: string
  title: string
  /** Plain text, or nodes when part of it needs emphasis. */
  body?: React.ReactNode
  /** ms before it dismisses itself. */
  duration?: number
  /** One button under the body, e.g. "Reload". Clicking it runs `onClick`
   *  and dismisses the toast. */
  action?: { label: string; onClick: () => void }
  /** "alert": red border and text, for something that must be noticed (a
   *  dev-server misconfiguration, a lost export). "warn": amber, for a
   *  caveat that does not stop anything (a slow file, a partial export),
   *  readable on both themes. Default: quiet. */
  tone?: "quiet" | "alert" | "warn"
}

type Entry = Toast & { id: number }

let toasts: Entry[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getSnapshot = () => toasts
// Server snapshot must be referentially stable or React loops; this app is a
// SPA but the docs site imports some of these components.
const EMPTY: Entry[] = []
const getServerSnapshot = () => EMPTY

/** Show a toast. Safe to call from anywhere — no React context needed. */
export function pushToast(toast: Toast): void {
  toasts = [...toasts.filter((t) => t.key !== toast.key), { ...toast, id: nextId++ }]
  emit()
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Convenience for components: `const toast = useToast(); toast({ key, title })`. */
export function useToast() {
  return pushToast
}

const ToastItem: React.FC<{ toast: Entry }> = ({ toast }) => {
  useEffect(() => {
    const t = setTimeout(() => dismissToast(toast.id), toast.duration ?? 4000)
    return () => clearTimeout(t)
  }, [toast.id, toast.duration])

  return (
    <div
      role="status"
      className={cn(
        // Text selectable (a version, a path, an error to copy); the cross dismisses.
        "pointer-events-auto relative select-text rounded-md border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        "max-w-[360px]",
        toast.tone === "alert" && "border-destructive bg-destructive/10",
        toast.tone === "warn" && "border-amber-500/60 bg-amber-500/10",
      )}
    >
      {/* The one way out, so a text selection never dismisses. */}
      <button type="button" aria-label="Dismiss" className="absolute right-1.5 top-1.5 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); dismissToast(toast.id) }}>
        <X className="h-3.5 w-3.5" />
      </button>
      <p className={cn("pr-5 text-sm font-medium", toast.tone === "alert" ? "text-destructive" : toast.tone === "warn" ? "text-amber-700 dark:text-amber-300" : "text-popover-foreground")}>{toast.title}</p>
      {toast.body && <div className={cn("mt-0.5 text-xs", toast.tone === "alert" ? "text-destructive/90" : toast.tone === "warn" ? "text-amber-800/90 dark:text-amber-200/90" : "text-muted-foreground")}>{toast.body}</div>}
      {toast.action && (
        <button
          type="button"
          className="mt-2.5 mx-auto block rounded-md border bg-background px-6 py-1.5 text-sm font-semibold text-popover-foreground shadow-sm hover:bg-accent cursor-pointer"
          onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); toast.action!.onClick() }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

/** Mount once, at the app root. Bottom-centre so it does not collide with the
 *  sidebar (left), the map controls (right) or the timeline (bottom-left). */
export const ToastHost: React.FC = () => {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (list.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {list.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}

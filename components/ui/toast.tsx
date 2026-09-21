import type React from "react"
import { useEffect } from "react"
import { atom, useAtom, useSetAtom } from "jotai"
import { cn } from "@/lib/utils"

/** A deliberately tiny toast. The app had no notification primitive at all and
 *  pulling in sonner for one message would be a dependency for a div — this is
 *  a queue atom plus a host that renders it above the map.
 *
 *  Messages are keyed: firing the same key again restarts its timer instead of
 *  stacking a duplicate, which is what you want when someone clicks the same
 *  disabled button three times. */
export interface Toast {
  key: string
  title: string
  body?: string
  /** ms before it dismisses itself. */
  duration?: number
}

const toastsAtom = atom<(Toast & { id: number })[]>([])

let nextId = 1

export const pushToastAtom = atom(null, (get, set, toast: Toast) => {
  const existing = get(toastsAtom)
  const without = existing.filter((t) => t.key !== toast.key)
  set(toastsAtom, [...without, { ...toast, id: nextId++ }])
})

const dismissToastAtom = atom(null, (get, set, id: number) => {
  set(toastsAtom, get(toastsAtom).filter((t) => t.id !== id))
})

/** Convenience hook: `const toast = useToast(); toast({ key, title })`. */
export function useToast() {
  return useSetAtom(pushToastAtom)
}

const ToastItem: React.FC<{ toast: Toast & { id: number } }> = ({ toast }) => {
  const dismiss = useSetAtom(dismissToastAtom)
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), toast.duration ?? 4000)
    return () => clearTimeout(t)
  }, [toast.id, toast.duration, dismiss])

  return (
    <div
      role="status"
      onClick={() => dismiss(toast.id)}
      className={cn(
        "pointer-events-auto cursor-pointer select-none rounded-md border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        "max-w-[320px]",
      )}
    >
      <p className="text-sm font-medium text-popover-foreground">{toast.title}</p>
      {toast.body && <p className="mt-0.5 text-xs text-muted-foreground">{toast.body}</p>}
    </div>
  )
}

/** Mount once, at the app root. Bottom-centre so it does not collide with the
 *  sidebar (left), the map controls (right) or the timeline (bottom-left). */
export const ToastHost: React.FC = () => {
  const [toasts] = useAtom(toastsAtom)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}

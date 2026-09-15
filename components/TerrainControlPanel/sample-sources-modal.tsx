import { useMemo } from "react"
import { Plus, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/** The two fields every sample entry (terrain or basemap) is guaranteed to have. */
export interface SampleLike {
  id: string
  name: string
  type?: string
  loadWithSamples?: boolean
}

/**
 * Picker for the shipped sample library. "Load Sample Sources" used to dump the
 * whole list into the user's BYOD sources in one go; with ~50 national datasets
 * that is more noise than help, so this lists them and lets each be added or
 * removed individually, with Load all / Clear all for the old behaviour.
 *
 * Membership is by id, so a row shows a minus when the user's list already holds
 * that sample — even a copy edited locally — and a plus otherwise. Adding a row
 * that is already present refreshes the stored copy from the sample definition,
 * which is the same merge-by-id rule the bulk action always had.
 *
 * Entries flagged loadWithSamples: false (project scans, regional extras) are
 * listed below a divider and are NOT part of Load all; they are still one click
 * away here, which is the whole point of listing rather than bulk-loading.
 */
export function SampleSourcesModal<T extends SampleLike>({
  open, onOpenChange, title, samples, current, setCurrent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  samples: readonly T[]
  current: T[]
  setCurrent: (next: T[]) => void
}) {
  const presentIds = useMemo(() => new Set(current.map((s) => s.id)), [current])
  const primary = samples.filter((s) => s.loadWithSamples !== false)
  const extras = samples.filter((s) => s.loadWithSamples === false)

  const add = (entries: readonly T[]) => {
    const ids = new Set(entries.map((s) => s.id))
    setCurrent([...current.filter((s) => !ids.has(s.id)), ...entries])
  }
  const remove = (entries: readonly T[]) => {
    const ids = new Set(entries.map((s) => s.id))
    setCurrent(current.filter((s) => !ids.has(s.id)))
  }
  const loadedCount = samples.filter((s) => presentIds.has(s.id)).length

  const Row = ({ s }: { s: T }) => {
    const present = presentIds.has(s.id)
    return (
      <div className="flex items-center gap-2 min-w-0 py-0.5">
        <span className="flex-1 min-w-0 text-sm truncate" title={s.name}>{s.name}</span>
        {s.type && <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{s.type}</span>}
        <Button
          variant={present ? "outline" : "secondary"}
          size="icon-sm"
          className="cursor-pointer shrink-0"
          aria-label={present ? `Remove ${s.name}` : `Add ${s.name}`}
          title={present ? "Remove from your sources" : "Add to your sources"}
          onClick={() => (present ? remove([s]) : add([s]))}
        >
          {present ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {loadedCount} of {samples.length} in your list. Add or remove one at a time, or take the whole set.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button className="cursor-pointer" onClick={() => add(primary)}>
            <Plus className="h-4 w-4" /> Load all
          </Button>
          <Button variant="outline" className="cursor-pointer" onClick={() => remove(samples)} disabled={loadedCount === 0}>
            <Minus className="h-4 w-4" /> Clear all
          </Button>
        </div>
        <div className="overflow-y-auto pr-1 -mr-1 divide-y divide-border/50">
          {primary.map((s) => <Row key={s.id} s={s} />)}
          {extras.length > 0 && (
            <>
              <p className="pt-3 pb-1 text-xs text-muted-foreground">
                Regional and project datasets — not included in Load all
              </p>
              {extras.map((s) => <Row key={s.id} s={s} />)}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

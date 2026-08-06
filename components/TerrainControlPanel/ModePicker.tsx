import type React from "react"
import { History, Mountain } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { AppMode } from "@/lib/settings-atoms"

const MODES: { id: AppMode; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    id: "terrain",
    label: "Terrain",
    description: "For micro-relief, feature extraction, and mapping — hillshade, relief, lighting, contours and terrain analysis over an elevation source.",
    icon: Mountain,
  },
  {
    id: "historical",
    label: "Historical Imagery",
    description: "For comparing historical basemap sources via a timeline — a simplified 2D view with no elevation source.",
    icon: History,
  },
]

export const ModePicker: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: AppMode
  onSelect: (mode: AppMode) => void
}> = ({ open, onOpenChange, mode, onSelect }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a mode</DialogTitle>
          <DialogDescription>The app's meta mode — which toolset and sidebar layout are in play.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {MODES.map(({ id, label, description, icon: Icon }) => {
            const selected = mode === id
            return (
              <Card
                key={id}
                onClick={() => onSelect(id)}
                className={cn(
                  "cursor-pointer py-4 gap-2 transition-colors hover:border-primary",
                  selected && "border-primary bg-primary",
                )}
              >
                <CardHeader className="flex flex-row items-center gap-3 px-4">
                  {/* CardTitle/CardDescription each carry their own hardcoded
                      text color class (text-card-foreground / text-muted-
                      foreground) at equal CSS specificity to a blanket
                      override on the Card itself — a tie Tailwind's generated
                      stylesheet doesn't reliably resolve in our favor (source
                      order, not DOM nesting, breaks the tie). Passing the
                      override directly as each element's own className
                      instead lets cn()'s twMerge drop the conflicting default
                      at the class-list level — no cascade ambiguity left to
                      resolve. */}
                  <Icon className={cn("h-5 w-5 shrink-0", selected ? "text-primary-foreground" : "text-muted-foreground")} />
                  <div className="space-y-1">
                    <CardTitle className={selected ? "text-primary-foreground" : undefined}>{label}</CardTitle>
                    <CardDescription className={selected ? "text-primary-foreground/80" : undefined}>{description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

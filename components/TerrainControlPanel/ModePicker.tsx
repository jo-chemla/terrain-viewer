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
          {MODES.map(({ id, label, description, icon: Icon }) => (
            <Card
              key={id}
              onClick={() => onSelect(id)}
              className={cn(
                "cursor-pointer py-4 gap-2 transition-colors hover:border-primary",
                mode === id && "border-primary bg-accent/50",
              )}
            >
              <CardHeader className="flex flex-row items-center gap-3 px-4">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <CardTitle>{label}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

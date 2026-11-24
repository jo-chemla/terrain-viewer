// The overlay row's alpha mode menu (lib/tile-transform-protocol.ts,
// TILE_ALPHA_MODES): what the tiles' transparency becomes. The choice is
// stored on the user's source record (alphaMode), beside its opacity; until
// the user picks one, the Library entry's default applies (sourceAlphaMode).
import type React from "react"
import { Blend } from "lucide-react"
import { cn } from "@/lib/utils"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TILE_ALPHA_MODES, TILE_ALPHA_MODE_INFO, parseAlphaMode, type TileAlphaMode } from "@/lib/tile-transform-protocol"

export const AlphaModeMenu: React.FC<{
  value: TileAlphaMode
  /** The Library's default for this source, marked in the list. */
  libraryDefault?: TileAlphaMode
  onChange: (mode: TileAlphaMode) => void
}> = ({ value, libraryDefault, onChange }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <button type="button" aria-label="Transparency" title={`Transparency: ${TILE_ALPHA_MODE_INFO[value].label}`}
          className={cn("cursor-pointer shrink-0 h-7 w-7 inline-flex items-center justify-center rounded-full border text-muted-foreground hover:bg-accent hover:text-accent-foreground", value !== "served" && "border-primary/60 text-primary")}>
          <Blend className="h-3.5 w-3.5" />
        </button>
      }
    />
    <DropdownMenuContent align="start" className="w-72">
      <DropdownMenuLabel className="text-xs">Transparency of the tiles</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(v) => { const m = parseAlphaMode(v); if (m) onChange(m) }}>
        {TILE_ALPHA_MODES.map((m) => (
          <DropdownMenuRadioItem key={m} value={m} className="cursor-pointer">
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{TILE_ALPHA_MODE_INFO[m].label}{m === libraryDefault ? <span className="ml-1.5 text-[10px] text-muted-foreground">(Library default)</span> : null}</span>
              <span className="text-[10px] text-muted-foreground break-words">{TILE_ALPHA_MODE_INFO[m].hint}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)

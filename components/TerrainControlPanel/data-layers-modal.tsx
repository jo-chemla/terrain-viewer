import { Check, Layers } from "lucide-react"
import { useSetAtom } from "jotai"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { revealSectionAtom } from "@/lib/settings-atoms"
import { cn } from "@/lib/utils"

/**
 * The Google-Earth-style "Data layers" picker: every visualization mode as a
 * card with the docs' own screenshot, one click to turn it on or off.
 *
 * The sidebar already exposes all of these as checkboxes, but as a list of
 * names inside collapsible sections - you have to know that "Openness" is a
 * relief mode and what it looks like before you can want it. A picture of
 * each answers both at once, which is also why a mode with no screenshot is
 * simply NOT LISTED here: a card whose picture is a grey placeholder icon
 * carries strictly less information than the sidebar checkbox it duplicates.
 * Everything is still in the sidebar; this is the illustrated subset.
 *
 * The screenshots are the docs site's own, served from /docs/screenshots/
 * (merged into dist/docs in prod; in dev vite.config.ts's proxy bypass points
 * that prefix straight at docs/public/screenshots, so the Next.js dev server
 * does not have to be running for the pictures to appear).
 *
 * Two kinds of card:
 *
 *  - A MODE toggles a `show*` flag in the URL state. Most sit under a master
 *    flag for their section (Terrain Analysis, Relief Visualization, Lighting
 *    Effects, Contours) that gates whether the section renders at all, so
 *    turning a card ON turns its master on too; turning it OFF leaves the
 *    master alone, which is what the sidebar's own checkboxes do.
 *  - A TOOL has no layer to toggle - it is a panel. Clicking one closes this
 *    dialog and reveals that sidebar section (revealSectionAtom: opens its
 *    macro group, opens the section, scrolls to it), which is the thing you
 *    actually wanted when you recognised the picture.
 */

type Mode = {
  key: string
  /** Section flag that has to be on for `key` to render, if any. */
  master?: string
  label: string
  blurb: string
  /** Path under /docs/screenshots/. Required: no picture, no card. */
  image: string
  /** Present on tools: the sectionOpenAtom key to open and scroll to. Makes
   *  this card a navigation target rather than a toggle. */
  section?: string
  /** Extra state a tool needs before its section will even render (the sun
   *  shadow calculator is behind a beta flag). */
  enable?: Record<string, unknown>
}

type Group = { title: string; blurb: string; modes: Mode[] }

const GROUPS: Group[] = [
  {
    title: "Base",
    blurb: "Shading and colour straight from elevation, plus the imagery under it.",
    modes: [
      { key: "showHillshade", label: "Hillshade", image: "viz-modes/hillshade.jpg", blurb: "Directional shading from a light in the sky. The default relief." },
      { key: "showColorRelief", label: "Hypsometric tint", image: "viz-modes/hypso.jpg", blurb: "Elevation as colour, on any ramp, with the range set from the viewport." },
      { key: "showContours", master: "showContoursAndGraticules", label: "Contours", image: "viz-modes/contours.jpg", blurb: "Isolines computed in the browser from the terrain source." },
      // Raster sits in Base rather than hard shadows: it is the layer every
      // other mode is drawn over or blended with, and it is the one thing
      // here that is not derived from elevation at all. Hard shadows moved
      // down to Light, where the sun already lives.
      { key: "showRasterBasemap", label: "Basemap imagery", image: "viz-modes/basemap.jpg", blurb: "Satellite, aerial or vector imagery draped on the terrain, from any of the basemap sources." },
    ],
  },
  {
    title: "Terrain analysis",
    blurb: "Surface derivatives and neighbourhood statistics, as in gdaldem.",
    modes: [
      { key: "showSlope", master: "showTerrainAnalysis", label: "Slope", image: "viz-modes/slope.jpg", blurb: "Steepness, the magnitude of the gradient." },
      { key: "showAspect", master: "showTerrainAnalysis", label: "Aspect", image: "viz-modes/aspect-multidir.jpg", blurb: "Which way a slope faces, the direction of the gradient." },
      { key: "showCurvature", master: "showTerrainAnalysis", label: "Curvature", image: "viz-modes/curvature.jpg", blurb: "Profile, plan, mean, Gaussian or Casorati: where the surface bends." },
      { key: "showTpi", master: "showTerrainAnalysis", label: "Position (TPI)", image: "viz-modes/tpi.jpg", blurb: "Elevation relative to the neighbourhood mean: ridges positive, valleys negative." },
    ],
  },
  {
    title: "Relief visualization",
    blurb: "Multi-scale relief and visibility, after the Relief Visualization Toolbox.",
    modes: [
      { key: "showLrm", master: "showReliefVisualization", label: "Local relief model", image: "viz-modes/lrm.jpg", blurb: "Elevation minus its own smoothed trend. Small features on any slope." },
      { key: "showSvf", master: "showReliefVisualization", label: "Sky-view factor", image: "viz-modes/svf.jpg", blurb: "How much sky a point can see. Enclosed ground darkens, ridges brighten, no light direction." },
      { key: "showOpenness", master: "showReliefVisualization", label: "Openness", image: "viz-modes/openness.jpg", blurb: "Mean horizon angle over a radius. Positive for convex features, negative for concave." },
    ],
  },
  {
    // Above Light because these are the things you DO with a terrain, and a
    // picture is the fastest way to find out a plane slicer exists at all.
    title: "Tools",
    blurb: "Panels rather than layers - clicking one opens it in the sidebar.",
    modes: [
      { key: "drawing", section: "drawing", label: "Draw and measure", image: "tools/draw.jpg", blurb: "Points, lines and polygons in layers, with lengths and areas. Imports and exports GeoJSON, KML, GPX." },
      { key: "elevationPicker", section: "elevationPicker", label: "Elevation picker, profile and slicer", image: "tools/elevation-picker-full.jpg", blurb: "Read elevation at a point, a profile along a line, or slice the terrain with a plane." },
      { key: "sunShadowCalculator", section: "sunShadowCalculator", enable: { sunShadowBeta: true }, label: "Sun and shadow calculator", image: "sun-shadow-calculator-reverse.png", blurb: "When is this spot in sun? Forwards for a date, or backwards from an observed shadow." },
      { key: "animation", section: "animation", label: "Camera animation", image: "tools/animation.jpg", blurb: "Keyframe a camera path and play it back, or export it." },
    ],
  },
  {
    title: "Light",
    blurb: "Shading from real surface normals, and the sun's real position.",
    modes: [
      { key: "showMatcap", master: "showLightingEffects", label: "Matcap", image: "viz-modes/matcap.jpg", blurb: "Colour looked up from a pre-lit sphere by surface normal. Stylised, no light direction." },
      { key: "showPhong", master: "showLightingEffects", label: "Phong", image: "viz-modes/phong.jpg", blurb: "Ambient, diffuse and specular from a compass-fixed light. Live on the GPU." },
      { key: "showShadows", label: "Hard shadows", image: "viz-modes/hard-shadows.jpg", blurb: "Cast shadows from the sun's actual position, for a date and time." },
    ],
  },
]

const IMAGE_BASE = `${import.meta.env.BASE_URL}docs/screenshots/`
/** Cards show the small copies, not the docs' full captures: the originals
 *  are 1-4 MB each and 37 MB together, which is what a grid of fourteen
 *  220 px thumbnails would have pulled on every open. docs/scripts/
 *  build-screenshot-thumbs.mjs writes them (640 px, always .jpg, same
 *  relative path under thumbs/) and reads this very file for the list. */
const thumbUrl = (image: string) => `${IMAGE_BASE}thumbs/${image.replace(/\.[^.]+$/, ".jpg")}`

export function DataLayersModal({ open, onOpenChange, state, setState }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: any
  setState: (updates: any) => void
}) {
  const reveal = useSetAtom(revealSectionAtom)
  const isOn = (m: Mode) => !m.section && !!state[m.key] && (!m.master || !!state[m.master])
  const activate = (m: Mode) => {
    if (m.section) {
      if (m.enable) setState(m.enable)
      onOpenChange(false)
      reveal(m.section)
      return
    }
    const next = !isOn(m)
    // A card turning ON has to bring its section with it, or nothing draws.
    setState(next && m.master ? { [m.key]: true, [m.master]: true } : { [m.key]: next })
  }
  const onCount = GROUPS.reduce((n, g) => n + g.modes.filter(isOn).length, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col gap-0 overflow-hidden p-0" showCloseButton={false}>
        <div className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <DialogHeader className="gap-0.5">
              <DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Data layers</DialogTitle>
              <DialogDescription>Every way this app can draw terrain. Click a card to turn it on or off; {onCount} on now.</DialogDescription>
            </DialogHeader>
            <DialogClose render={<Button variant="ghost" size="sm" className="cursor-pointer">Done</Button>} />
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-4 space-y-6">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="text-sm font-semibold">{g.title}</h3>
              <p className="text-xs text-muted-foreground mb-2">{g.blurb}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.modes.map((m) => {
                  const on = isOn(m)
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => activate(m)}
                      aria-pressed={m.section ? undefined : on}
                      className={cn(
                        "group overflow-hidden rounded-lg border text-left transition-colors cursor-pointer hover:border-foreground/40",
                        on && "border-primary ring-2 ring-primary/40",
                      )}
                    >
                      <div className="relative aspect-[16/10] w-full bg-muted">
                        <img src={thumbUrl(m.image)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        {on && (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground shadow">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <div className="px-2 py-2">
                        <div className={cn("text-xs leading-tight", on ? "font-semibold" : "font-medium")}>{m.label}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-2">{m.blurb}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted-foreground">
            Illustrated modes only - Ruggedness, Roughness, Blobness and Local dominance have no screenshot yet and live in the sidebar's
            own Terrain Analysis and Relief Visualization sections. Each mode's parameters appear there once it is on.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

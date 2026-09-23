import { Check, ImageOff, Layers } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The Google-Earth-style "Data layers" picker: every visualization mode as a
 * card with the docs' own screenshot, one click to turn it on or off.
 *
 * The sidebar already exposes all of these as checkboxes, but as a list of
 * names inside collapsible sections - you have to know that "Openness" is a
 * relief mode and what it looks like before you can want it. A picture of
 * each answers both at once. The screenshots are the docs site's, served from
 * /docs/screenshots/ (merged into dist/docs in prod, proxied in dev), so
 * there is one copy and the two stay in step.
 *
 * Every mode is a `show*` flag in the URL state, and most sit under a master
 * flag for their section (Terrain Analysis, Relief Visualization, Lighting
 * Effects, Contours) that gates whether the section renders at all. Turning a
 * card ON therefore turns its master on too; turning it OFF leaves the master
 * alone, which is what the sidebar's own checkboxes do.
 */

type Mode = {
  key: string
  /** Section flag that has to be on for `key` to render, if any. */
  master?: string
  label: string
  blurb: string
  /** File under docs/public/screenshots/viz-modes/, if a screenshot exists. */
  image?: string
}

type Group = { title: string; blurb: string; modes: Mode[] }

const GROUPS: Group[] = [
  {
    title: "Base",
    blurb: "Shading and colour straight from elevation.",
    modes: [
      { key: "showHillshade", label: "Hillshade", image: "hillshade.jpg", blurb: "Directional shading from a light in the sky. The default relief." },
      { key: "showColorRelief", label: "Hypsometric tint", image: "hypso.jpg", blurb: "Elevation as colour, on any ramp, with the range set from the viewport." },
      { key: "showContours", master: "showContoursAndGraticules", label: "Contours", image: "contours.jpg", blurb: "Isolines computed in the browser from the terrain source." },
      { key: "showShadows", label: "Hard shadows", image: "hard-shadows.jpg", blurb: "Cast shadows from the sun's actual position, for a date and time." },
    ],
  },
  {
    title: "Terrain analysis",
    blurb: "Surface derivatives and neighbourhood statistics, as in gdaldem.",
    modes: [
      { key: "showSlope", master: "showTerrainAnalysis", label: "Slope", image: "slope.jpg", blurb: "Steepness, the magnitude of the gradient." },
      { key: "showAspect", master: "showTerrainAnalysis", label: "Aspect", image: "aspect-multidir.jpg", blurb: "Which way a slope faces, the direction of the gradient." },
      { key: "showCurvature", master: "showTerrainAnalysis", label: "Curvature", image: "curvature.jpg", blurb: "Profile, plan, mean, Gaussian or Casorati: where the surface bends." },
      { key: "showTri", master: "showTerrainAnalysis", label: "Ruggedness (TRI)", blurb: "Mean elevation difference to the neighbours." },
      { key: "showTpi", master: "showTerrainAnalysis", label: "Position (TPI)", image: "tpi.jpg", blurb: "Elevation relative to the neighbourhood mean: ridges positive, valleys negative." },
      { key: "showRoughness", master: "showTerrainAnalysis", label: "Roughness", blurb: "Max minus min elevation in a neighbourhood." },
      { key: "showBlobness", master: "showTerrainAnalysis", label: "Blobness", blurb: "Structure-tensor detector for peaks, pits and saddles." },
    ],
  },
  {
    title: "Relief visualization",
    blurb: "Multi-scale relief and visibility, after the Relief Visualization Toolbox.",
    modes: [
      { key: "showLrm", master: "showReliefVisualization", label: "Local relief model", image: "lrm.jpg", blurb: "Elevation minus its own smoothed trend. Small features on any slope." },
      { key: "showSvf", master: "showReliefVisualization", label: "Sky-view factor", image: "svf.jpg", blurb: "How much sky a point can see. Enclosed ground darkens, ridges brighten, no light direction." },
      { key: "showOpenness", master: "showReliefVisualization", label: "Openness", image: "openness.jpg", blurb: "Mean horizon angle over a radius. Positive for convex features, negative for concave." },
      { key: "showLocalDominance", master: "showReliefVisualization", label: "Local dominance", blurb: "How much a spot towers over its surroundings. Mounds, terraces, plateaus." },
    ],
  },
  {
    title: "Light",
    blurb: "Shading from real surface normals.",
    modes: [
      { key: "showMatcap", master: "showLightingEffects", label: "Matcap", image: "matcap.jpg", blurb: "Colour looked up from a pre-lit sphere by surface normal. Stylised, no light direction." },
      { key: "showPhong", master: "showLightingEffects", label: "Phong", image: "phong.jpg", blurb: "Ambient, diffuse and specular from a compass-fixed light. Live on the GPU." },
    ],
  },
]

const IMAGE_BASE = `${import.meta.env.BASE_URL}docs/screenshots/viz-modes/`

export function DataLayersModal({ open, onOpenChange, state, setState }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: any
  setState: (updates: any) => void
}) {
  const isOn = (m: Mode) => !!state[m.key] && (!m.master || !!state[m.master])
  const toggle = (m: Mode) => {
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
                      onClick={() => toggle(m)}
                      aria-pressed={on}
                      className={cn(
                        "group overflow-hidden rounded-lg border text-left transition-colors cursor-pointer hover:border-foreground/40",
                        on && "border-primary ring-2 ring-primary/40",
                      )}
                    >
                      <div className="relative aspect-[16/10] w-full bg-muted">
                        {m.image ? (
                          <img src={IMAGE_BASE + m.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ImageOff className="h-5 w-5" />
                          </div>
                        )}
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
            Each mode's parameters live in its own sidebar section once it is on. Fuller descriptions and the maths are in Settings and the docs.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

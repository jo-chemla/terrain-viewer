# TODO / Future Work

Notes for later — not scheduled, don't start without explicit go-ahead.

## Local COG: service worker fallback (option 2)

Context pasted 2026-07-16. Blob URL streaming (already implemented) covers Chromium;
this would be the more robust, cross-browser fallback if blob: Range-fetch support
turns out to be a real problem in the field (Safari/Firefox).

> Service worker as a local range server (the robust no-companion answer): register
> a small SW; when the user picks a COG, post the File object to it (Files are
> structured-cloneable); the SW intercepts `GET /local-cog/{id}` and answers Range
> requests with 206 responses built from `file.slice(start, end)`. From the app's
> point of view this is a plain same-origin HTTPS URL — no mixed content, no CORS,
> no server, and the geomatico protocol plus all your existing BYOD plumbing (zoom
> detection, source config) work unchanged. With the File System Access API you can
> persist the file handle in IndexedDB so the source survives reloads in Chromium
> (one permission re-prompt); Safari/Firefox users just re-pick the file per session.

## Arbitrary-CRS COG streaming: custom maplibre protocol

Context pasted 2026-07-16, following research into `developmentseed/deck.gl-raster`
(see conversation history) — that project's rewrite does now support arbitrary-CRS
COGs via GPU-based reprojection, but as a deck.gl overlay layer, not a maplibre
protocol, and it isn't built to feed maplibre's own `raster-dem`/`setTerrain()`
elevation pipeline directly.

> The realistic path to actually fix our CRS problem using this ecosystem wouldn't
> be adopting deck.gl wholesale — it'd be using their new building blocks
> (`@developmentseed/geotiff` reader + `@developmentseed/epsg`/`proj` reprojection
> math) to write our own new maplibre custom protocol (same pattern as our existing
> `cog://`/`slope://` handlers) that reprojects+resamples elevation into terrain-rgb
> tiles on the fly. That's a real, scoped project — want me to spike whether
> `@developmentseed/geotiff` + `epsg` are usable standalone (outside deck.gl) for
> that?

This would directly fix the EPSG:3857-only limitation documented in the README's
"Local (offline) COG terrain sources" section, for both local and remote COGs.

## Tells detector: candidate descriptor volumes (A–G) — keep vs. drop

Context pasted 2026-07-16, from an exploration of additional shape-descriptor
volumes for the Tells (mound candidate) detector, alongside the existing
Blobness/Plan/Det-Hessian filters.

Legitimate / distinct — worth adding:

| Vol | Name | Description | Legitimate interest | Closest known concept |
|---|---|---|---|---|
| **A** | DoG(LRM) | Difference of two Gaussian-smoothed versions of LRM at scale σ / kσ | High — real, discretization-stable blob detector | SIFT / DoG≈LoG blob detector |
| **D** | Structure tensor blobness | det(J)/trace(J) of the smoothed gradient outer-product matrix | High — distinct from A/C/F, discriminates round blobs from ridges/edges | Förstner interest operator |
| **C** | Flow divergence | div(∇f/\|∇f\|), clipped to positive | High, but **not new** — this is exactly plan curvature, just reframed as "clip to summits" | Plan curvature / level-set curvature flow |
| **F** | Determinant of Hessian | fxx·fyy − fxy² | High — distinct differential quantity, ~Gaussian curvature (unnormalized) | SURF / DoH blob detector |

Redundant or not useful — skip:

| Vol | Name | Description | Legitimate interest | Closest known concept |
|---|---|---|---|---|
| **B** | DoG(hillshade luminance) | DoG applied to multi-light shaded luminance instead of elevation | Low — redundant proxy for A through a noisier nonlinear lens | Same DoG idea, weaker signal |
| **E** | Saturation DoG | DoG on HSV saturation of the multi-dir hillshade | Low — heuristic tied to this specific 4-hue color scheme, not a general terrain property | Ad hoc / perceptual annulus cue |
| **G** | Gradient curl | fyx − fxy | Not legitimate as a standalone terrain quantity — see below | Discretization residual (Sobel asymmetry), not a real invariant |

<details><summary>Details</summary>

**Is DoG(LRM) a second-order derivative?**

Yes, in effect — it's a "second derivative done twice," which is why it's a good
detector but not a clean differential quantity you can name in closed form:

- LRM itself is already a first, band-stop-like operation: elevation minus its own
  local-minimum-filtered trend. That's not a derivative in the strict sense (it's
  morphological, not linear), but functionally it's a high-pass — it kills
  wavelengths longer than approx 2×SIGMA_TREND.
- DoG on top of that is itself an approximation of a second derivative —
  DoG(σ, kσ) ≈ σ²·∇²(Gaussian-smoothed field) (this is the standard DoG≈LoG
  identity from scale-space theory).

So vol_A is roughly a Laplacian-of-a-high-pass-of-elevation, i.e. a fourth-order-ish
composite operator once you count LRM's implicit high-pass. That's precisely why
it's such a good blob detector (two independent scale-selective stages both
suppress anything that isn't "bump-shaped at roughly this size") but also why it's
expensive and not something you'd cleanly rename as "Nth derivative of elevation"
— it's two cascaded nonlinear-ish filters, not one clean operator.

**Building the Laplacian/DoG via pyramid levels**

Same trick as `lrm-protocol.ts`, extended to two ancestor levels instead of one:

- `coarse1 = bilinear(ancestor at z − k1)`
- `coarse2 = bilinear(ancestor at z − k2)`, with `k2 > k1`
- `DoG ≈ coarse1 − coarse2` (a genuine Laplacian-pyramid difference, the same
  construction SIFT uses per-octave)

Zoom-level choice: pick `k1`, `k2` relative to the current source zoom, not the
map's viewport zoom — same reasoning as the existing `radiusToLevels()` in
`lrm-protocol.ts:39`. A reasonable ladder mirroring the Python σ=2→10px range:
`k1=1` (≈2× native res, σ≈2px equivalent), `k2=3` (≈8×, σ≈8-10px equivalent) — so
2 fetches instead of 5, since pyramid levels only give you dyadic (2×) scale steps
rather than log-spaced ones. If you want a proper multi-scale stack (not just one
DoG band) you'd add a 3rd level, e.g. `k=[1,2,3]` → two DoG bands (L1−L2, L2−L3) —
cheap because each ancestor fetch is shared across all the fine tiles under it
(same caching benefit LRM already gets), and there's no real Gaussian convolution
at all, just fetch + bilinear resample + subtract.

**Can D and F be as cheap as current Plan curvature?**

- **F (det Hessian)**: yes, essentially the same cost as Plan curvature. The
  curvature protocol already computes second derivatives (fxx, fyy, fxy) via a
  3×3 same-zoom neighborhood — det(Hessian) = fxx·fyy − fxy² is just a different
  combination of the exact same three values already computed for
  Combined/Profile/Plan. This is nearly a free addition — same padded-grid fetch,
  same Sobel-style kernels, one extra line of arithmetic.
- **D (structure tensor blobness)**: a bit more, but still cheap. It needs
  `J = smoothed(gx·gx, gy·gy, gx·gy)` — that smoothing is a small Gaussian/box blur
  over a window (not a single 3×3), so it's one step beyond the pure-pointwise 3×3
  stencils TRI/TPI/Curvature use today. In practice: compute gx, gy from a padded
  grid (same as now), then a modest fixed-radius box blur (5–9px, cheap, separable)
  on the three products before the det/trace ratio. Comparable in cost to what
  Roughness/TPI already do over their neighborhood window — not free like
  Curvature, but far cheaper than the Python script's full log-spaced 5-scale
  sweep, since you'd fix it at one scale rather than looping over σ.

**On DoG(LRM) being 2nd-order, not 4th-order** (correction to the above)

- LoG (Laplacian of Gaussian) = ∇²(Gaussian-smoothed z) — this is fundamentally a
  2nd-order operator (the Laplacian is a sum of 2nd derivatives).
- DoG (Difference of Gaussians) is the classic scale-space approximation to LoG:
  DoG(σ1,σ2) ≈ (σ2−σ1)·σ·∇²G. It approximates a 2nd-order operator, so it is one,
  just computed via subtraction instead of differentiation.
- LRM (raw − low-pass) is the same idea at heart: subtracting a smoothed version
  from the original approximates a high-pass/Laplacian-like response — again
  2nd-order in character, not a derivative-of-a-derivative stack.

So DoG(LRM) is best described as a (2nd-order-ish) band-pass/Laplacian-like
operator, not a 4th-order one. There's no compounding of derivative orders here —
subtracting two blurs doesn't stack differentiation order, it approximates a
single 2nd-order operator directly.

</details>

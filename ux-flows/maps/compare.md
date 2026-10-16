# F1 · Compare two terrain sources

Intro: A reviewer adds a second terrain source and chooses how to compare the two: as an overlay with a slider, matched colours and a blend mode, or as side-by-side views that can grow to a 2×2 grid and switch to historical imagery.

Notes: Node ids in the diagram are screen ids from screens.json. `==>` is the main route, `-->` an alternative, `-.->` optional or a way back. `{ }` nodes are decisions and have no screenshot.

```mermaid
flowchart TD
  cmp_single[Single view] ==> split{Split style?}
  split ==>|Overlay| cmp_overlay[Overlay with slider]
  split -->|Side by side| cmp_side[Side by side, 2x1]
  cmp_overlay ==>|Match colors| cmp_overlay_match[Colours matched to A]
  cmp_overlay_match ==>|Blend mode: difference| cmp_overlay_blend[Difference blend]
  cmp_overlay_blend ==>|Move the slider| cmp_overlay_slider[Slider at 30%]
  cmp_overlay_slider ==>|Blend off| cmp_overlay_blend_off[Blend toggled off]
  cmp_overlay_blend_off -.->|Blend on again| cmp_overlay_slider
  cmp_side ==>|2x2 grid| cmp_side_2x2[Four views, 2x2]
  cmp_side_2x2 ==>|Historical mode| cmp_side_historical[Historical imagery, 2x2]
  cmp_side_historical ==>|Match colors| cmp_side_match[Colours matched to A]
```

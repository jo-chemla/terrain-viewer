---
name: Transparent UI slider hold
description: How the panel fades while a slider or XY pad is dragged and the dragged control stays opaque (lib/slider-hold.ts + two CSS rules), what a new control needs, and the dead end of per-component opacity
type: project
---
With Transparent UI on (`transparentUiAtom`), dragging a slider turns the panel see-through (`activeSliderAtom` non-null → the Card goes `bg-background/20`, in TerrainControlPanel.tsx) and fades everything except the dragged control (Jonathan, 2026-10-10: the slider, its value readout and its bound inputs must stay fully opaque, in every section).

**Mechanism (one for every control, since 2026-10-10):** `lib/slider-hold.ts` + the "Transparent UI" rules at the end of `src/index.css`.
- `Section` carries `data-fade-scope`.
- On press, `MobileSlider` / `SphericalXYPad` call `holdControl(el)`, which sets `data-slider-held` on the control's unit: the nearest `data-slider-group` ancestor, else the control's **parent element** (in the option sections that is already the "label row with DraftBoundInputs + slider" block, so raw MobileSliders need nothing). A non-empty group value is a key: every group with that key in the scope is held (the light Date/Time sliders and the XY pad share `sliderId`). `holdWholeSection` (Hillshade's pad) holds the whole scope (`data-slider-held="section"`).
- CSS: scopes without a held unit fade whole; inside the holding scope, the children (at each level of the path down to the held unit) that neither are nor contain a held unit fade. Nothing is faded twice and the held unit never sits under a faded ancestor.

**A new control:** use `MobileSlider` (not the bare `ui/slider`) and put it in the same parent as its label/value/inputs, or wrap them in `data-slider-group=""`. Nothing else.

**Dead end:** the old per-component `isDimmed` / `dimWhenSliding` classes (opacity-20 on each component, Section dimmed unless the active id started with its `useId` prefix). A raw MobileSlider with an unprefixed `sliderId` ("slope:range", "lrm:range", …) made its own Section dim its whole content, slider included — opacity on a parent cannot be undone by a child. Do not reintroduce component-level opacity for this.

Not covered: dialogs (settings dialog Cesium detail, custom-basemap modal opacity) keep the bare `Slider`; the historical timeline has no slider (its ticks/track are its own pointer handlers). Verified headless with `.cache/pw/transparent-ui.mjs` (effective opacity 1 for the held group, 0.2 elsewhere).

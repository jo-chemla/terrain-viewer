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
- The holding scope's header row (`data-fade-keep` on the Section header) stays lit, so the section being edited is named (as the old per-component dimming did for its own section).
- The card's background drops from the 20% `activeSliderAtom` gives it (TerrainControlPanel.tsx) to 8% while any unit is held (`#tour-sidepanel:has([data-slider-held])`, src/index.css), for sliders and pads alike. The card's alpha was 20% before the refactor too: what looked clearer then was the accidental double fade (Section 0.2 × row 0.2 = 0.04 on the other rows), which this replaces. Measured veil (mean |panel − bare map| per channel over the card, held group and title bar excluded): ~39-40 at 20%, ~21-24 at 8%.
- `LightDirectionControl`'s root is a slider group keyed by its `sliderId` (as are its pad and Date/Time sliders), and Lighting Effects' two Light Direction folds carry the same key (`phong-light`, `shadow-light`): holding the pad or a Date/Time slider keeps the fold title, mode, lights, sliders and pad lit. Hillshade's pad still holds its whole section.

**A new control:** use `MobileSlider` (not the bare `ui/slider`) and put it in the same parent as its label/value/inputs, or wrap them in `data-slider-group=""`. Nothing else.

**Dead end:** the old per-component `isDimmed` / `dimWhenSliding` classes (opacity-20 on each component, Section dimmed unless the active id started with its `useId` prefix). A raw MobileSlider with an unprefixed `sliderId` ("slope:range", "lrm:range", …) made its own Section dim its whole content, slider included — opacity on a parent cannot be undone by a child. Do not reintroduce component-level opacity for this.

Not covered: dialogs (settings dialog Cesium detail, custom-basemap modal opacity) keep the bare `Slider`; the historical timeline has no slider (its ticks/track are its own pointer handlers). Verified headless with `.cache/pw/transparent-ui.mjs` (effective opacity 1 for the held group, 0.2 elsewhere) and `.cache/pw/tui-v2.mjs` (card alpha, header, group and veil for Slope Range, hypso bounds, a viz-mode row, the Hillshade, Phong and Shadows pads; screenshots in `.cache/transparent-ui/v2/`).

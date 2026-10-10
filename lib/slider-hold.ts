// Transparent UI: while a slider (or an XY pad) is dragged, the side panel
// turns see-through so the map shows, and everything in the panel fades
// except the control being dragged. One mechanism for every control, driven
// by three data attributes and two CSS rules (src/index.css, "Transparent
// UI"):
//
// - `data-fade-scope` — a unit that fades as a whole when the held control is
//   elsewhere (each Section carries it).
// - `data-slider-group` — the unit kept opaque around a control: its label,
//   value readout, bound inputs. Optional: without one, the control's parent
//   element is the unit, which in the option sections is already the
//   "label row + slider" block. A non-empty value is a key: every group with
//   the same key in the same scope is held together (the Date/Time sliders
//   and the light XY pad share one, so the pad stays lit while either moves).
// - `data-slider-held` — set here, on the unit(s), for the length of a drag.
//   `data-slider-held="section"` holds the whole fade scope (the Hillshade
//   XY pad keeps its whole section opaque).
//
// Inside the scope that holds the control, the CSS fades every element that
// neither is nor contains a held unit and whose parent contains one - the
// siblings along the path down to the control, so nothing is faded twice and
// the held unit is never under a faded ancestor (opacity can't be undone by
// a child). A new control gets this for free by going through MobileSlider.

export const FADE_SCOPE_ATTR = "data-fade-scope"
export const SLIDER_GROUP_ATTR = "data-slider-group"
export const SLIDER_HELD_ATTR = "data-slider-held"

/** Marks the unit around `control` held (see above) and returns the release. */
export function holdControl(control: Element | null, opts: { wholeSection?: boolean } = {}): () => void {
  if (!control) return () => {}
  const scope = control.closest(`[${FADE_SCOPE_ATTR}]`)
  let units: Element[]
  if (opts.wholeSection && scope) {
    units = [scope]
  } else {
    const group = control.closest(`[${SLIDER_GROUP_ATTR}]`)
    const key = group?.getAttribute(SLIDER_GROUP_ATTR)
    units = group && key
      ? Array.from((scope ?? document).querySelectorAll(`[${SLIDER_GROUP_ATTR}="${CSS.escape(key)}"]`))
      : [group ?? control.parentElement ?? control]
  }
  const value = opts.wholeSection ? "section" : ""
  for (const u of units) u.setAttribute(SLIDER_HELD_ATTR, value)
  return () => { for (const u of units) u.removeAttribute(SLIDER_HELD_ATTR) }
}

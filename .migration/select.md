# select

2026-07-28, transformation engine, verdict: the most structurally-changed
primitive in this migration (`position` -> `alignItemWithTrigger`,
`Viewport`->`List`, `ScrollUp/DownButton`->`ScrollUp/DownArrow`); 7 consumer
call sites needed the `string | null` widening fix.

## Changed

- [components/ui/select.tsx](../components/ui/select.tsx): swapped
  `@radix-ui/react-select` for `@base-ui/react/select`'s `Select` namespace.
  Typed the root wrapper via `SelectPrimitive.Root.Props<string>` (Select's
  `Root` is generic over `<Value, Multiple>`; pinning `Value` to `string`
  matches this project's exclusively-string-value usage and makes consumer
  `onValueChange` types line up). `Content` restructured into
  `Portal > Positioner > Popup > (ScrollUpArrow, List, ScrollDownArrow)` —
  `Viewport` renamed to `List`, `ScrollUpButton`/`ScrollDownButton` renamed
  to `ScrollUpArrow`/`ScrollDownArrow`, `Label` renamed to `GroupLabel`
  (Base UI's own `Select.Label` is a *different*, new part that labels the
  trigger itself, not groups — did not use it, per the skill's explicit
  warning not to conflate the two). Original `position="popper"` (this
  project's implicit default, never overridden anywhere) mapped to
  `alignItemWithTrigger={false}` (the closest Base UI equivalent — `false`
  is the "popper" behavior, `true`/default is "item-aligned"); confirmed via
  grep that no call site ever passed `position=`, so this default swap is
  risk-free. `--radix-select-content-available-height` /
  `--radix-select-content-transform-origin` /
  `--radix-select-trigger-height`/`-width` renamed to `--available-height`/
  `--transform-origin`/`--anchor-height`/`--anchor-width`.
  `SelectPrimitive.Icon`'s internal `asChild` usage (not exposed to
  consumers) converted directly to `render={<ChevronDownIcon .../>}` since
  that's our own code, not a public API surface needing the asChild shim.
- Leftover scan: clean.

## Left alone

Nothing else.

## Consumer sweep: `onValueChange` widened to `string | null`

Base UI's `Select.Root.onValueChange` signature is `(value: Value | null,
eventDetails) => void` — `null` means "nothing selected" (Radix's was always
a plain non-null `string`). 7 call sites passed a bare `(value: string) =>
void` setter directly as `onValueChange` and needed a null-guard, since
these are all always-a-value selects (never actually reach the "nothing
selected" state in practice): `CameraUtilities.tsx` (export resolution
picker), `controls-components.tsx` (`CycleButtonGroup`), `curvature-options-
section.tsx`, `custom-basemap-modal.tsx` / `custom-terrain-source-modal.tsx`
(linked-source pickers, which already had a lambda — added the null guard
inline), `custom-color-ramp.tsx` (ramp-registry `Select`), `theme-switcher.tsx`
(color-theme picker). Pattern applied everywhere: `onValueChange={(value) =>
value && handler(value)}`.

## Behavior changes

None expected — every affected select always has a selected value in
practice, so the `null` branch introduced by the guard is dead code, not a
functional change.

## Post-migration fix: Value showed raw value, List showed only one row

User testing surfaced two real bugs beyond the initial migration:

1. **`<SelectValue />` displayed the raw `value` instead of the item's
   label** whenever they differed (e.g. Hillshade Method's
   `{ value: "combined", label: "Combined [2d]" }` showed "combined").
   Radix's `Select.Value` auto-displayed the matched item's `ItemText`
   content; Base UI's doesn't unless `Root` is given an `items` lookup. Fixed
   by adding `collectSelectItems`/`extractSelectItemText` helpers to
   `select.tsx` that walk the JSX `children` passed to `Select` (recursing
   through `SelectGroup`/`Fragment`/etc.) to build a `{value, label}[]` array
   automatically, passed as `Root`'s `items` prop — no call-site changes
   needed anywhere. Verified live: the Hillshade Method trigger now reads
   "Combined [2d]" instead of "combined".
2. **The popup only showed one row of options / long lists (e.g. themes)
   drew past the window.** Two compounding bugs in `SelectContent`:
   - `List` had `h-(--anchor-height)` copied over from the original Radix
     wrapper's popper-mode `Viewport` sizing trick, forcing the list to the
     *trigger's own height* (collapsing it to ~1 row). Removed, keeping
     `min-w-(--anchor-width)` for width parity.
   - `max-h-(--available-height)` had been placed on `Positioner` instead of
     `Popup`. `Positioner` has no `overflow-hidden` to actually enforce a
     height cap on its own, so `Popup` (which does have `overflow-y-auto`)
     just grew to fit all its content with nothing to clip it, drawing past
     the viewport for long lists. Moved `max-h-(--available-height)` onto
     `Popup` (matching the working pattern already used in
     `dropdown-menu.tsx`/`tooltip.tsx`), so it now actually caps the popup to
     the available space and scrolls internally.

## Verify by hand

- Live-tested the Hillshade Method select in a dev server during this
  migration: opens on click, lists all 5 items with correct labels
  ("Combined [2d]", "Standard [1d]", "Aspect (Multidir Colors)", "Igor [1d]",
  "Basic [2d]"), and closes correctly on Escape (`aria-expanded` flips
  true->false). Re-verify the other 6 selects listed above (theme picker,
  ramp picker, curvature type, linked-source pickers, camera export
  resolution) the same way, plus scroll-arrow behavior on a select with more
  items than fit on screen.

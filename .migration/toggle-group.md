# toggle-group

2026-07-28, transformation engine, verdict: restructured to callable
`ToggleGroup` + `Toggle`-as-item; largest consumer-code sweep of the whole
migration (`type`/`value` API change hit 7 call sites).

## Changed

- [components/ui/toggle-group.tsx](../components/ui/toggle-group.tsx):
  swapped `@radix-ui/react-toggle-group` for `@base-ui/react/toggle-group`'s
  callable `ToggleGroup` (was `Root`) and `@base-ui/react/toggle`'s `Toggle`
  (Base UI reuses the standalone Toggle primitive as group items — was
  `ToggleGroupPrimitive.Item`). Kept both `ToggleGroup`/`ToggleGroupItem` as
  `React.forwardRef`-wrapped components (not converted to plain function
  components) — the existing code comment explains why: wrapping a
  `ToggleGroupItem` in a `<TooltipTrigger asChild>` needs to forward a ref
  down to the real DOM node, and a plain function component can't receive
  `ref` without `forwardRef` in React 18. Retyped both via
  `ToggleGroupPrimitive.Props<string>` / `TogglePrimitive.Props<string>`
  (not `ComponentProps<typeof X>`) for the same generic-resolution reason as
  `toggle.tsx`/`radio-group.tsx`.
- Leftover scan: clean.

## Consumer sweep (the actual breaking surface)

Radix's `type="single"|"multiple"` + scalar `value` is gone; Base UI's
`ToggleGroup` only has `multiple` (boolean) and an *always-array* `value`/
`onValueChange`. Rewrote every single-select call site from
`type="single" value={x} onValueChange={(v) => v && fn(v)}` to
`value={[x]} onValueChange={([v]) => v && fn(v)}`:

- `controls-components.tsx` — `SegmentedToggle<T>` (the generic wrapper used
  by several other files' segmented pickers).
- `contour-options-section.tsx` — contour weight (1×/2×/4×) picker.
- `custom-color-ramp.tsx` — ramp shape (sequential/diverging) and fade
  (center/edges) pickers, two separate `ToggleGroup`s in the same file.
- `elevation-reference-toggle.tsx` — Absolute/LRM reference picker.
- `plane-slicer-fields.tsx` — paint-side (below/above) picker.

Also renamed the `data-[state=on]:*`/`data-[state=off]:*` class pairs used by
these same components' item classes (`WEIGHT_TOGGLE_ITEM_CLASS`,
`TOGGLE_ITEM_CLASS` x2, `ELEVATION_REFERENCE_TOGGLE_ITEM_CLASS`) to
`data-pressed:*` for the "on" look, folding the old "off" variant into the
unprefixed default classes (Base UI's Toggle only emits a presence attribute
for pressed=true; there's no "off"/"unpressed" attribute to select on).

## Behavior changes

None expected — the single-select semantics are preserved exactly (arrays of
length 0 or 1), just represented as an array instead of a bare string/`""`.

## Verify by hand

- Contour weight picker, ramp shape/fade pickers, Absolute/LRM toggle, and
  paint-side toggle in Plane Slicer: click through each option and confirm
  exactly one stays visually pressed and the underlying state actually
  updates (not just the visual).
- The generic `SegmentedToggle` (used broadly) — pick any instance in the
  app and click through its options.

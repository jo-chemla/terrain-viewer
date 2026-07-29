# switch

2026-07-28, transformation engine, verdict: clean 1:1 swap.

## Changed

- [components/ui/switch.tsx](../components/ui/switch.tsx): swapped
  `@radix-ui/react-switch` for `@base-ui/react/switch`'s `Switch` namespace
  (`Root`/`Thumb`, same part names). `data-[state=checked]:*` ->
  `data-checked:*`, `data-[state=unchecked]:*` -> `data-unchecked:*`
  throughout (Root and Thumb both), `disabled:cursor-not-allowed
  disabled:opacity-50` -> `data-disabled:*` (Root renders `<span>` + hidden
  input, same reasoning as checkbox/radio).
- Leftover scan: clean.

## Left alone

Nothing else. Three app-code call sites style a Switch's `className` with
`data-[state=checked]:bg-primary` directly (`CameraUtilities.tsx`,
`light-direction-control.tsx`, `raster-basemap-section.tsx`) — all three
renamed to `data-checked:bg-primary` as part of the consumer sweep (see
[project.md](project.md)), not tracked separately here since they're plain
class renames with identical intent.

## Behavior changes

None expected.

## Verify by hand

- Toggle the "Complete"/"Smooth" camera-keyframe switch and the light-
  direction switches; confirm the thumb slides and the track recolors in
  both themes.

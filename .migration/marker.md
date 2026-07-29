# marker

2026-07-28, transformation engine, verdict: clean `useRender`/`mergeProps`
swap.

## Changed

- [components/ui/marker.tsx](../components/ui/marker.tsx): replaced
  `Slot.Root` (imported from the unified `radix-ui` package) with `useRender`
  + `mergeProps`, `defaultTagName: 'div'`, same `asChild` shim pattern as
  badge/item. `MarkerIcon`/`MarkerContent` are plain `<span>`s — untouched.
- Leftover scan: clean.

## Left alone

`MarkerIcon`, `MarkerContent`.

## Behavior changes

None.

## Verify by hand

- Any `<Marker asChild>` usage renders correctly with classes merged onto
  the custom child element.

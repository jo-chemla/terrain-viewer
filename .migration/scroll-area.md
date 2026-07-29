# scroll-area

2026-07-28, transformation engine, verdict: clean rename-only swap.

## Changed

- [components/ui/scroll-area.tsx](../components/ui/scroll-area.tsx): swapped
  the unified `radix-ui` package's `ScrollArea` export for
  `@base-ui/react/scroll-area`'s `ScrollArea` namespace. `Root`/`Viewport`/
  `Corner` keep their names; `ScrollAreaScrollbar` -> `Scrollbar`,
  `ScrollAreaThumb` -> `Thumb` (rename only, same role).
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

None expected.

## Verify by hand

- Scroll a long panel/list that uses `<ScrollArea>` and confirm the custom
  scrollbar thumb still appears and drags correctly.

# separator

2026-07-28, transformation engine, verdict: direct 1:1 swap.

## Changed

- [components/ui/separator.tsx](../components/ui/separator.tsx): swapped
  `import * as SeparatorPrimitive from '@radix-ui/react-separator'` for
  `import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'`
  (single-part primitive, callable directly — no `.Root`). Dropped the
  `decorative` prop (no Base UI equivalent; it only ever mapped to
  `aria-hidden`/`role="none"` internally and Radix's default was already
  `true`, matching Base UI's fixed behavior).
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

None observable — `orientation` and the `data-[orientation=...]` classes are
unchanged.

## Verify by hand

- Visual check: horizontal/vertical separators in Sidebar, Item, ButtonGroup
  still render as thin lines at the right thickness.

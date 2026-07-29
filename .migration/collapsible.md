# collapsible

2026-07-28, transformation engine, verdict: direct part-rename swap.

## Changed

- [components/ui/collapsible.tsx](../components/ui/collapsible.tsx): swapped
  `@radix-ui/react-collapsible`'s namespace import for
  `import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'`.
  `CollapsiblePrimitive.CollapsibleTrigger` -> `.Trigger`,
  `.CollapsibleContent` -> `.Panel` (Content renamed to Panel, per the
  disclosure-family mapping). `data-slot` attributes unchanged.
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

- Base UI's Collapsible Root renders a plain `<div>` and doesn't carry
  `data-state`/`data-disabled` itself (those live on Trigger/Panel now) — this
  project's `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` wrappers
  don't add any custom classes keyed off Collapsible's own state, so nothing
  to fix, but flagging in case a consumer ever styles `Collapsible` directly.

## Verify by hand

- Every "fold/expand section" in the settings sidebar (dozens of
  `CollapsibleSection`s) still animates open/closed and the chevron rotates.

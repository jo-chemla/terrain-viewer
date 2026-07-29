# item

2026-07-28, transformation engine, verdict: clean `useRender`/`mergeProps`
swap.

## Changed

- [components/ui/item.tsx](../components/ui/item.tsx): `Item`'s
  `const Comp = asChild ? Slot : 'div'` replaced with `useRender` +
  `mergeProps`, `defaultTagName: 'div'`, same `asChild` compatibility prop
  pattern as badge.tsx. `ItemGroup`/`ItemMedia`/`ItemContent`/`ItemTitle`/
  `ItemDescription`/`ItemActions`/`ItemHeader`/`ItemFooter` are all plain
  `<div>`/`<p>` wrappers with no Radix dependency — untouched.
  `ItemSeparator` re-exports the already-migrated `Separator` — untouched.
- Leftover scan: clean.

## Left alone

`ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`,
`ItemHeader`, `ItemFooter`, `ItemGroup` — plain elements, never used Radix.

## Behavior changes

None.

## Verify by hand

- Any `<Item asChild>` usage (if present) renders its child element with
  Item's classes merged on, not wrapped in an extra `<div>`.

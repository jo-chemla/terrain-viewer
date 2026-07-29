# button-group

2026-07-28, transformation engine, verdict: clean swap — one `useRender`
conversion, one already-migrated `Separator` re-export.

## Changed

- [components/ui/button-group.tsx](../components/ui/button-group.tsx):
  `ButtonGroupText`'s `const Comp = asChild ? Slot : 'div'` replaced with
  `useRender` + `mergeProps`, `defaultTagName: 'div'`, same `asChild` shim
  pattern as badge/item/marker. `ButtonGroup` is a plain `<div>` — untouched.
  `ButtonGroupSeparator` re-exports the already-migrated `Separator` —
  untouched.
- Leftover scan: clean.

## Left alone

`ButtonGroup`.

## Behavior changes

None.

## Verify by hand

- A `<ButtonGroup>` containing a mix of `<Button>`/`<Select>`/`<Input>`
  still renders with the correct shared border-radius/border-collapse
  styling (the `[&>*]:...` selectors in `buttonGroupVariants` are untouched).

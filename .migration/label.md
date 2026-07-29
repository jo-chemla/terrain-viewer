# label

2026-07-28, transformation engine, verdict: clean drop of the primitive.

## Changed

- [components/ui/label.tsx](../components/ui/label.tsx): removed
  `@radix-ui/react-label` entirely; `Label` now renders a plain native
  `<label>` (Radix's Label primitive has no Base UI counterpart — it was
  always just an accessible `<label>` wrapper). Dropped the `forwardRef`
  boilerplate (`React.ElementRef`/`ComponentPropsWithoutRef`/`displayName`)
  since a native `<label>` doesn't need it; kept the exact same className and
  `data-slot="label"`.
- Leftover scan: `grep -n "radix-ui\|@radix-ui" components/ui/label.tsx` ->
  clean.

## Left alone

Nothing else in this file.

## Behavior changes

None. `<label>` semantics are identical; `peer-disabled:`/
`group-data-[disabled=true]:` selectors are untouched and still apply the
same way since they target sibling/ancestor state, not the label element
itself.

## Verify by hand

- Click a `<Label htmlFor="x">` next to a checkbox/switch/radio and confirm
  focus still moves to the control (native `<label>`/`htmlFor` behavior,
  unaffected by this change).

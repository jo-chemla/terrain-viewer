# button

2026-07-28, transformation engine, verdict: migrated to the real Base UI
Button primitive (not a hand-rolled `useRender` wrapper, per the migration
skill's explicit correction note).

## Changed

- [components/ui/button.tsx](../components/ui/button.tsx): replaced
  `@radix-ui/react-slot`'s `Slot` with `@base-ui/react/button`'s `Button`
  primitive. `buttonVariants` (the `cva` config) is untouched byte-for-byte.
  `asChild` is kept as a compatibility prop: when `true`, `children` (assumed
  a single element, matching the old asChild contract) is passed as the
  primitive's own `render` prop instead of being rendered as `children`;
  otherwise `render`/`children` pass straight through. This preserves every
  existing `<Button asChild><Link/></Button>`-style call site (checked: dozens
  across the app) with zero call-site changes.
- Leftover scan: clean.

## Left alone

Nothing else in this file.

## Behavior changes

None expected — Base UI's Button primitive renders a native `<button>` by
default (same as before) and forwards all standard button props/events
unchanged.

## Verify by hand

- Click a few `asChild` buttons that wrap `<Link>`/`<a>` elements (e.g. the
  "Suggest a new terrain source" link button) and confirm they still navigate
  and carry the button's visual styling.
- Tab/keyboard-focus through a row of buttons and confirm focus rings
  (`focus-visible:ring-*`) still show.

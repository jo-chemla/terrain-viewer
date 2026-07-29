# checkbox

2026-07-28, transformation engine, verdict: clean 1:1 swap.

## Changed

- [components/ui/checkbox.tsx](../components/ui/checkbox.tsx): swapped
  `@radix-ui/react-checkbox` for `@base-ui/react/checkbox`'s `Checkbox`
  namespace (`Root`/`Indicator`, same part names). Renamed
  `data-[state=checked]:*` -> `data-checked:*` throughout the wrapper's
  className. Renamed the trailing `disabled:cursor-not-allowed
  disabled:opacity-50` to `data-disabled:cursor-not-allowed
  data-disabled:opacity-50` — Base UI's Checkbox Root renders a `<span>` +
  hidden `<input>`, not a real `<button>`/native form control, so the
  `disabled:` Tailwind pseudo-class variant is dead on the Root element now;
  `data-disabled` is the attribute Base UI actually sets.
- Leftover scan: clean.

## Left alone

Nothing else. No consumer in this app uses Radix's `checked="indeterminate"`
string value (confirmed by grep) — Base UI's separate `indeterminate` boolean
prop was not needed anywhere.

## Behavior changes

None expected.

## Verify by hand

- Click a checkbox (e.g. "Show Contour Lines") and confirm the check icon
  appears/disappears and the box background/border color changes correctly
  in both light and dark themes.

# radio-group

2026-07-28, transformation engine, verdict: restructured across two
primitives, per Base UI's `RadioGroup`/`Radio` split.

## Changed

- [components/ui/radio-group.tsx](../components/ui/radio-group.tsx): Radix's
  single `RadioGroupPrimitive` namespace (`Root`/`Item`/`Indicator`) is split
  in Base UI into `@base-ui/react/radio-group`'s callable `RadioGroup`
  (single-part, was Root) and `@base-ui/react/radio`'s `Radio` namespace
  (`Root`/`Indicator`, was Item/Indicator). Typed both wrapper components'
  props via `RadioGroupPrimitive.Props<string>` /
  `RadioPrimitive.Root.Props<string>` explicitly (not `ComponentProps<typeof
  X>`) — same generic-resolution issue as `toggle.tsx`; without the explicit
  `<string>`, consumer `onValueChange(value: string) => void` handlers across
  the app failed to type-check because the inferred `Value` type came back
  `unknown`. Dropped the `forwardRef`/`displayName` boilerplate (both parts
  are now plain function components; Base UI's own primitives accept `ref`
  natively via their generic call signatures).
- Renamed `data-[state=checked]:*` -> `data-checked:*` implicitly (none were
  actually present in this wrapper's classes, but the `disabled:cursor-not-
  allowed disabled:opacity-50` trailing classes were renamed to
  `data-disabled:*` on `RadioGroupItem`, same reasoning as checkbox.tsx:
  `Radio.Root` renders a `<span>` + hidden input, not a native radio input.
- Leftover scan: clean.

## Left alone

Nothing else.

## Post-migration fix: dot/pill misalignment

User testing found the filled center dot visually offset from the outer
circle. Root cause: `RadioGroupItem`'s className never declared `relative`,
and `Radio.Indicator`'s className was only `flex items-center justify-center`
(no explicit size) — relying on the Indicator's box happening to equal the
Root's box for the dot's own `absolute + translate` centering trick to land
in the right place. That assumption held under Radix's rendering but not
Base UI's. Fixed by making the box relationship explicit instead of
implicit: added `relative` to `RadioGroupItem`, and changed
`Radio.Indicator` to `absolute inset-0 flex items-center justify-center`
(exactly fills Root, then flex-centers the dot; dropped the now-redundant
`absolute top-1/2 left-1/2 -translate-x/y-1/2` from the `CircleIcon` itself).
Verified via computed `getBoundingClientRect()`: dot center now matches the
outer pill's center exactly.

## Behavior changes

None expected for existing callers (all pass plain string values).

## Verify by hand

- Any `<RadioGroup>`/`<RadioGroupItem>` usage (grep found none outside
  `components/ui/` at migration time — flag if one gets added later) selects
  correctly and shows the filled dot.

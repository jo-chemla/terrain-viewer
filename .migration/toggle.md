# toggle

2026-07-28, transformation engine, verdict: direct swap, one class rename.

## Changed

- [components/ui/toggle.tsx](../components/ui/toggle.tsx): swapped
  `@radix-ui/react-toggle`'s `TogglePrimitive.Root` for the callable
  `Toggle` export of `@base-ui/react/toggle` (single-part primitive, no
  `.Root`). Typed the wrapper's props as `TogglePrimitive.Props &
  VariantProps<...>` (not `React.ComponentProps<typeof TogglePrimitive>` —
  `Toggle` is a generic `<Value extends string>` call signature and
  `ComponentProps` doesn't resolve generics correctly on those; using the
  namespace's own `.Props` type, which defaults `Value` to `string`, is the
  fix, same pattern needed later for RadioGroup/Radio/Select/Slider).
  `data-[state=on]:bg-accent data-[state=on]:text-accent-foreground` in
  `toggleVariants` renamed to `data-pressed:bg-accent
  data-pressed:text-accent-foreground` (Base UI emits a presence attribute,
  no `data-state` value).
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

None functionally; purely a selector rename with identical visual result.

## Verify by hand

- `AdvancedModeToggle`/`PinToggle`/`SourceAbToggle` in
  `controls-components.tsx` (all plain `<Toggle pressed={...}>` usages, no
  group) still show the pressed/unpressed visual state correctly.

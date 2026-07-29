# badge

2026-07-28, transformation engine, verdict: clean `useRender`/`mergeProps`
swap per the migration skill's worked example.

## Changed

- [components/ui/badge.tsx](../components/ui/badge.tsx): replaced the
  `Slot`-based `const Comp = asChild ? Slot : 'span'` idiom with
  `useRender` (`@base-ui/react/use-render`) + `mergeProps`
  (`@base-ui/react/merge-props`), `defaultTagName: 'span'`. `asChild` is kept
  as a prop (Badge is a display-only component, never itself exposed via a
  Radix primitive, so there's no "real primitive" to migrate to — `useRender`
  IS the correct target here per the skill). Had to cast every object handed
  to `mergeProps` to `Omit<React.ComponentProps<'span'>, 'ref'>` — the plain
  `React.ComponentProps<'span'>` includes a legacy string-`ref` type that
  `mergeProps`'s stricter `PropsOf<T>` rejects; this is the documented
  `mergeProps` pitfall (data-* keys + ref typing), not a real behavior issue.
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

None.

## Verify by hand

- A Badge used with `asChild` wrapping an `<a>` (if any exist) still gets the
  badge's classes merged onto the anchor, not wrapped in an extra `<span>`.

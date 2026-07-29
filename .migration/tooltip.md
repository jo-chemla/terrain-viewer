# tooltip

2026-07-28, transformation engine, verdict: restructured to
`Portal > Positioner > Popup`; added a small context bridge to keep the
`delayDuration` call-site prop working since Base UI moved delay off Root.

## Changed

- [components/ui/tooltip.tsx](../components/ui/tooltip.tsx): swapped
  `@radix-ui/react-tooltip` for `@base-ui/react/tooltip`'s `Tooltip`
  namespace. `Content` restructured into `Portal > Positioner > Popup`
  (positioning props — `side`/`sideOffset`/`align`/`alignOffset` — now live
  on `Positioner`, forwarded explicitly per the migration skill's "Pick means
  forward" rule, not left to fall through `...props` onto Popup). Rewrote the
  Radix `animate-in/out` + `zoom-in-95`/`slide-in-from-*` keyframe classes as
  a `transition-[transform,opacity]` with `data-starting-style`/
  `data-ending-style` (Base UI's enter/exit hooks) plus `origin-(--transform-origin)`
  (the renamed CSS var, was `--radix-tooltip-content-transform-origin`).
  Preserved the project's own `disablePointerEvents` customization (default
  `true`) unchanged — this isn't a stock shadcn prop, it's this project's
  addition, and it survived the hand-transform as-is.
- **New**: `delayDuration` moved from Radix's `Tooltip.Root` prop to Base
  UI's `Tooltip.Trigger.delay` — but this app calls `<Tooltip
  delayDuration={300}>` widely with `<TooltipTrigger>` authored separately as
  a JSX child, so there's no direct prop path from Root to Trigger. Added a
  `TooltipDelayContext` (React context, internal to this file only) that
  `Tooltip` populates from its `delayDuration` prop and `TooltipTrigger`
  reads as a fallback for its own `delay` prop (an explicit `delay` passed
  directly to `TooltipTrigger` still wins). This keeps the existing
  `<Tooltip delayDuration={N}>` call-site API 100% unchanged.
- `TooltipTrigger` also gained the same `asChild` -> `render` compatibility
  shim as Button/Badge (Base UI's `Trigger` accepts `render` natively; no
  `nativeButton` prop exists on Tooltip's Trigger per its `.d.ts`, so it
  wasn't added).
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

- `TooltipProvider`'s `delayDuration`/`skipDelayDuration` props renamed to
  `delay`/`timeout` — fixed at all 3 call sites (see
  [project.md](project.md)), not a silent behavior change since the prop
  names literally didn't exist anymore and it was a compile error.
- Default `sideOffset` stays `4` (matches both Radix's original override in
  this wrapper and Base UI's own new default — no change either way).

## Verify by hand

- Hover various icon buttons with tooltips (Settings gear, fold/expand-all,
  pin toggles) and confirm the delay feels right per call site (some pass
  `delayDuration={0}`, others don't) — this exercises the new
  `TooltipDelayContext` bridge specifically.
- Confirm tooltip enter/exit still has a smooth fade+zoom (not an abrupt
  pop), verifying the `data-starting-style`/`data-ending-style` rewrite.

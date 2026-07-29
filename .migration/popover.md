# popover

2026-07-28, transformation engine, verdict: restructured to
`Portal > Positioner > Popup`; `Anchor` dropped per Base UI (unused in this
app, so zero live impact).

## Changed

- [components/ui/popover.tsx](../components/ui/popover.tsx): swapped
  `@radix-ui/react-popover` for `@base-ui/react/popover`'s `Popover`
  namespace. Restructured `Content` into `Portal > Positioner > Popup`,
  forwarding `side`/`sideOffset`/`align`/`alignOffset` explicitly onto
  `Positioner`. Rewrote the `animate-in/out`+`zoom-in-95`+`slide-in-from-*`
  classes to `transition-[transform,opacity]` +
  `data-starting-style`/`data-ending-style` + `origin-(--transform-origin)`,
  same pattern as tooltip/dialog. `PopoverTrigger` gained the same `asChild`
  compatibility shim as Button/Badge/DialogTrigger.
- **Anchor dropped**: Base UI's Popover has no `Anchor` part (the migration
  skill flags this as one of the two known no-equivalent parts, alongside
  NavigationMenu's Indicator). `PopoverAnchor` is kept exported as an inert
  `{children}` passthrough per the skill's hard rule ("inert passthrough +
  flag") rather than deleted, but **it was unused anywhere in the app**
  (confirmed by grep before touching this file), so this has zero live
  behavioral impact today. If a future consumer needs anchor-to-a-different-
  element behavior, pass `anchor={...}` directly to `PopoverPrimitive.Positioner`
  inside `PopoverContent` instead of trying to compose `PopoverAnchor`.
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

None expected for existing usage (Anchor was dead code).

## Verify by hand

- Open any `<Popover>` in the app (e.g. a color picker or info popover) and
  confirm it positions correctly relative to its trigger and animates in/out
  smoothly.

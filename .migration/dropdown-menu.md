# dropdown-menu

2026-07-28, transformation engine, verdict: full canonical menu-family
restructure. **Unused anywhere in this app** (confirmed by grep before and
after touching the file) — zero live consumer-side risk.

## Changed

- [components/ui/dropdown-menu.tsx](../components/ui/dropdown-menu.tsx):
  swapped the unified `radix-ui` package's `DropdownMenu` export for
  `@base-ui/react/menu`'s `Menu` namespace (Base UI renames the whole family
  from `DropdownMenu` to `Menu`; the shadcn wrapper names — `DropdownMenu*` —
  are kept as-is since that's what the rest of a shadcn project expects to
  import). Canonical part renames applied: `Label` -> `GroupLabel`,
  `ItemIndicator` -> `CheckboxItemIndicator`/`RadioItemIndicator` (split by
  parent item type), `Sub` -> `SubmenuRoot`, `SubTrigger` -> `SubmenuTrigger`,
  `Content`/`SubContent` -> `Portal > Positioner > Popup` (both, with
  `side`/`sideOffset`/`align`/`alignOffset` forwarded explicitly onto
  `Positioner` for the main `Content`; `SubContent` sets `align="start"`
  explicitly on its Positioner, matching Radix's SubContent default which
  Base UI's Positioner doesn't share — its own default is `'center'`).
  `DropdownMenuTrigger` got the `asChild` shim. Rewrote the `animate-in/out`
  classes on both Content and SubContent to
  `transition-[transform,opacity]`+`data-starting/ending-style`, and
  `--radix-dropdown-menu-content-*` CSS vars to `--available-height`/
  `--transform-origin`. `data-[disabled]:*`/`data-[variant=...]:*` on
  `DropdownMenuItem` renamed to `data-disabled:*` (parameterized
  `data-[variant=...]:*` selectors left as-is, still correct Tailwind v4
  syntax). `DropdownMenuSubTrigger`'s `data-[state=open]:bg-accent` (its
  *actually live* open-submenu highlight, unlike dialog/sheet's dead
  close-button selector) renamed to `data-popup-open:bg-accent` — Base UI's
  SubmenuTrigger's open marker is `data-popup-open`, not `data-open`.
- **Default preserved explicitly**: Base UI's `CheckboxItem`/`RadioItem`
  default `closeOnClick={false}` (Radix always closed the menu on select).
  Set `closeOnClick={true}` as the wrapper's own default on both
  `DropdownMenuCheckboxItem`/`DropdownMenuRadioItem` to keep the familiar
  "picking an option closes the menu" UX if/when this component gets used.
- Leftover scan: clean.

## Left alone

Nothing else. No context-menu/menubar/navigation-menu wrappers exist in this
project (only `dropdown-menu.tsx`), so those parts of the reference doc
weren't needed.

## Behavior changes

None live (unused component); the `closeOnClick={true}` default above is a
forward-looking preservation of Radix's behavior, documented here rather than
silently assumed.

## Verify by hand

This component has no current callers — when it's first wired up, manually
verify: keyboard nav + typeahead across items, submenu open/close on
hover+click, checkbox/radio item toggling and menu-close behavior, and
Escape/outside-click dismissal.

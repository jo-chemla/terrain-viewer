# dialog

2026-07-28, transformation engine, verdict: restructured (`Overlay`->
`Backdrop`, `Content`->`Popup`, centered modal has no Positioner); one real
consumer fix (`onInteractOutside` moved to `onOpenChange`).

## Changed

- [components/ui/dialog.tsx](../components/ui/dialog.tsx): swapped
  `@radix-ui/react-dialog` for `@base-ui/react/dialog`'s `Dialog` namespace.
  `Overlay` renamed to `Backdrop`; `Content` renamed to `Popup` (centered
  modals render Popup directly, no `Positioner` — matches Radix's centered-
  modal model). `DialogTrigger`/`DialogClose` both gained the `asChild`
  compatibility shim (Base UI's `render` natively). Rewrote the
  `animate-in/out`+`zoom-in-95` classes on both Backdrop and Popup to
  `transition-[opacity]`/`transition-[transform,opacity]` +
  `data-starting-style`/`data-ending-style`. The built-in `X` close button's
  `data-[state=open]:bg-accent data-[state=open]:text-muted-foreground`
  classes were mechanically renamed to `data-open:*` — **this selector was
  already dead CSS before the migration** (Radix's `Dialog.Close` never
  carried a `data-state` attribute; this looks like copy-paste drift from a
  trigger-style class list in the original shadcn source) and is renamed
  as-is rather than "fixed" into something that would newly activate, per the
  migration skill's rule to preserve pre-existing quirks rather than
  invent new behavior.
- Leftover scan: clean.

## Left alone

Nothing else in this file.

## Behavior changes

None from the wrapper itself. See the one real consumer fix below.

## Consumer fix: `settings-dialog.tsx`

`DialogContent`'s `onInteractOutside` prop no longer exists (Base UI moved
all outside-dismiss interception onto the Root's `onOpenChange` callback via
`eventDetails.reason`). `settings-dialog.tsx` used this to keep the Settings
dialog open when a click originated inside the advanced theme editor panel
(portaled to `<body>` as a sibling, so it reads as "outside" the dialog).
Rewrote as: `Dialog onOpenChange={(open, eventDetails) => { if (!open &&
eventDetails.reason === 'outside-press') { check
eventDetails.event.target.closest('.tec-panel'); if matched, call
eventDetails.cancel() and return; } onOpenChange(open) }}`. Same intent,
different call-site shape.

## Verify by hand

- Open Settings, open the advanced theme editor from inside it, click around
  in the editor panel, and confirm the Settings dialog does **not** close
  (this exercises the rewritten `onInteractOutside`->`onOpenChange` logic
  directly).
- Open/close a couple of plain dialogs (e.g. any confirmation modal) and
  confirm the backdrop fades and the popup scales/fades in smoothly.

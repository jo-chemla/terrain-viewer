# sheet

2026-07-28, transformation engine, verdict: same restructure as dialog, plus
the per-side slide animation rewritten from keyframe utilities to
translate-based starting/ending-style transitions.

## Changed

- [components/ui/sheet.tsx](../components/ui/sheet.tsx): swapped
  `@radix-ui/react-dialog` (Sheet is built on the same Dialog primitive as
  `dialog.tsx`) for `@base-ui/react/dialog`'s `Dialog` namespace, aliased
  `SheetPrimitive`. Same `Overlay`->`Backdrop`, `Content`->`Popup` renames as
  dialog.tsx; `SheetTrigger`/`SheetClose` got the same `asChild` shim.
  The per-side slide-in/out (`data-[state=open]:slide-in-from-right` /
  `data-[state=closed]:slide-out-to-right`, one variant per side) was
  rewritten as explicit `data-starting-style:translate-x-full
  data-ending-style:translate-x-full` (and the mirrored/rotated equivalents
  for left/top/bottom), combined with the existing `transition` + `ease-in-
  out` + `data-closed:duration-300 data-open:duration-500` (renamed from
  `data-[state=closed/open]:duration-*`). The built-in close button's
  `data-[state=open]:bg-secondary` renamed to `data-open:bg-secondary`
  (same "already-dead-CSS, renamed as-is" note as dialog.tsx's close button).
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

None intended — the translate-based starting/ending-style rewrite is meant
to reproduce the exact same slide direction and duration as before.

## Verify by hand

- Open the mobile sidebar (renders as a `Sheet` on narrow viewports/on the
  "open sidebar" button) and confirm it slides in from the correct edge and
  slides back out on close, at roughly the same speed as before (300ms
  close / 500ms open, per the `data-closed:duration-300
  data-open:duration-500` classes).

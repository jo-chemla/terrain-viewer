---
name: UI overflow rules
description: Why selects and dialogs kept overflowing (flex min-width auto, grid min-content tracks), the contract now carried by components/ui, and what a new control must not do
type: project
---

# UI overflow rules

## The two recurring bugs

- **Select trigger grows past its container or spills its text.** A long option label ("Thin plate spline, non-rigid (beta, 3+ points)" in the georeferencer's Transform select, 2026-10-08) made the trigger wider than its row, or the text ran under the chevron. Cause: a flex item's automatic minimum width is its min-content, and the trigger was `whitespace-nowrap` with no `min-w-0`, so it refused to shrink below the full label. Fixed widths (`w-[140px]` etc.) hid the same problem until a longer label arrived (contour Measure's "Hard shadow (0 shaded, 128 lit)" in 180 px, the hypsometric License Type's "Open License & Distribute Yes" in 210 px).
- **Dialog wider than its box.** `DialogContent` is a one-column grid. A grid track's default `auto` minimum is the min-content of its items, so a `truncate` (nowrap) title or an unbroken URL widened the column past the box and every row overflowed with it (source info dialog, fixed by hand with `min-w-0` on the header in 204d02f: column 514 px in a 462 px box before, 462 after).

## The contract, now in the primitives (2026-10-08)

- `components/ui/select.tsx`: `SelectTrigger` is `flex min-w-0 max-w-full overflow-hidden`, the chevron `shrink-0`; `SelectValue` is `block flex-1 min-w-0 truncate` and sets its own `title` from the rendered text (a MutationObserver: Base UI writes the label after the commit). `SelectContent` popup is `max-w-[min(28rem,calc(100vw-2rem))]`; `SelectItem` is `whitespace-normal break-words` so long options wrap instead of widening the popup.
- `components/ui/dialog.tsx`: `DialogContent` is `grid grid-cols-[minmax(0,1fr)] min-w-0 max-w-[calc(100vw-2rem)] overflow-hidden` (callers that scroll add `overflow-y-auto`; twMerge keeps x hidden and y auto); `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` carry `min-w-0 break-words`.
- `components/ui/sheet.tsx` and `components/ui/popover.tsx`: the same `min-w-0 max-w-[calc(100vw-2rem)] overflow-hidden break-words` on the content, `min-w-0 break-words` on the sheet header, title, description.

Measured headless (`.cache/pw/ui-overflow-check.mjs`, dev server port as argument): the georef trigger ends at its parent's right edge with the value truncated (272 px of text in 212 px, ellipsis), the popup is 320 px with a 448 px cap, and a 400-character nowrap title plus a 400-character URL description leave the dialog column at 398 px in a 446 px box.

## Rules for a new control

1. Use the primitives; do not rebuild a select, dialog, sheet or popover from Base UI parts.
2. No fixed width on a `SelectTrigger` whose labels may exceed it: `flex-1 min-w-0` in a row, `w-full` in a column. A fixed width is fine for two-digit values (hour, minute).
3. Every flex or grid parent of a select, or of a dialog title, gets `min-w-0`; a grid `1fr` column is written `minmax(0,1fr)` (`grid-cols-[80px_minmax(0,1fr)]`), never bare `1fr`.
4. A long URL or file name gets `break-all` (or `truncate` with a `title`) inside a `min-w-0` cell; a `truncate` element needs a shrinkable chain of `min-w-0` up to the box.
5. The caller-side band-aids still around (`[&>span]:truncate`, `overflow-hidden` on triggers, `min-w-0` on dialog headers) are redundant now and harmless; do not add new ones.

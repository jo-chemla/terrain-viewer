# tabs

2026-07-28, transformation engine, verdict: clean rename swap; one behavior
delta flagged (not patched).

## Changed

- [components/ui/tabs.tsx](../components/ui/tabs.tsx): swapped
  `@radix-ui/react-tabs` for `@base-ui/react/tabs`'s `Tabs` namespace.
  `Trigger` renamed to `Tab`, `Content` renamed to `Panel`.
  `data-[state=active]:*` -> `data-active:*` throughout `TabsTrigger`'s
  className. Added `aria-disabled:pointer-events-none
  aria-disabled:opacity-50` alongside the existing `disabled:pointer-events-none
  disabled:opacity-50` (Base UI's Tab surfaces disabled state via
  `aria-disabled` in some code paths in addition to the native `disabled`
  attribute; keeping both covers either).
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

- **Flagged, not patched**: Base UI 1.6.0's `Tabs.List` defaults to *manual*
  keyboard activation (`activateOnFocus` opt-in), where Radix defaulted to
  *automatic* (arrow-focus immediately switches the active tab).
  `TabsList` was **not** given `activateOnFocus` — if arrow-key tab-switching
  feels different after this migration, that's the first place to look; add
  `activateOnFocus` to `TabsList` deliberately if Radix's automatic behavior
  is wanted back.

## Verify by hand

- `gdal-tabs.tsx` (URL Template / GDAL_WMS XML / gdal_translate / gdaldem)
  and any other `<Tabs>` usage: click through tabs, confirm the active tab's
  background/text-color highlight (`data-active:*`) still applies, and try
  arrow-key navigation to check the activation-mode behavior noted above.

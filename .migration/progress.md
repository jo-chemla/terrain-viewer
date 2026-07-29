# progress

2026-07-28, transformation engine, verdict: restructured to the new
Track/Indicator anatomy; fixed a latent accessibility bug along the way.

## Changed

- [components/ui/progress.tsx](../components/ui/progress.tsx): swapped
  `@radix-ui/react-progress` for `@base-ui/react/progress`'s `Progress`
  namespace. Restructured `Root > Indicator` (manual
  `style={{transform: translateX(...)}}` fill calc) into `Root > Track >
  Indicator`, where the Indicator now computes its own `width: n%` internally
  (confirmed in `ProgressIndicator.js`) — the wrapper no longer does the
  `100 - (value || 0)` math itself.
- **Fixed in passing**: the original Radix wrapper destructured `value` out
  of props for its own translateX calculation but never passed it back to
  `ProgressPrimitive.Root` (`{...props}` no longer included it) — so the
  underlying Radix primitive's `aria-valuenow` was always unset. Base UI's
  `ProgressRoot.value` is a *required* `number | null` prop (no default), so
  this had to be fixed to compile: `value={value ?? null}` is now passed
  explicitly.
- Leftover scan: clean.

## Left alone

Nothing else.

## Behavior changes

- Accessibility improvement, not a regression: `aria-valuenow` on the
  progress bar is now actually set (see above) where it silently wasn't
  before.

## Verify by hand

- Any progress bar in the app (search for `<Progress value=`) still fills to
  the correct width visually.

# slider

2026-07-28, transformation engine, verdict: restructured anatomy
(`Root > Control > Track > Indicator/Thumb`), consumer-side generic-callback
fixes required in 3 files.

## Changed

- [components/ui/slider.tsx](../components/ui/slider.tsx): swapped
  `@radix-ui/react-slider` for `@base-ui/react/slider`'s `Slider` namespace.
  Radix's `Root > Track > Range` + sibling `Thumb`(s) becomes Base UI's
  `Root > Control > Track > (Indicator, Thumb(s))` — the new `Control` part
  (no Radix equivalent) is the interactive pointer surface, so the original
  Root's full layout class string (`relative flex w-full touch-none
  items-center select-none data-[disabled]:opacity-50
  data-[orientation=vertical]:...`) moved from `Root` onto `Control`; `Root`
  itself is now just a thin non-visual wrapper. `Range` renamed to
  `Indicator`. Thumbs moved from being Track's siblings to Track's children,
  and each now gets an explicit `index={index}` (recommended for SSR of
  multi-thumb sliders per Base UI's docs). Added `thumbAlignment="edge"` on
  Root — Base UI defaults thumb alignment to `'center'`, but Radix's slider
  always behaved edge-aligned; this is a default-preserving choice, not new
  behavior. Typed the wrapper's props as `SliderPrimitive.Root.Props<number[]>`
  explicitly (pinning the `Value` generic) rather than
  `ComponentProps<typeof Root>` — needed for consumer callback types to
  resolve to `number[]` instead of the union default `number | readonly
  number[]`.
- Leftover scan: clean.

## Left alone

Nothing else in this file.

## Post-migration fix: `onValueChange` crash ("number 0.2 is not iterable")

User testing hit a real crash: `Uncaught TypeError: number 0.2 is not
iterable` inside a consumer's `([v]) => onSliderChange(v)` callback. Root
cause, found by reading Base UI's own `SliderRoot.js`: whether `onValueChange`
is called with a plain number or an array is decided by Base UI's *internal*
`range = Array.isArray(valueUnwrapped)` check, where `valueUnwrapped` comes
from `useControlled({ controlled: valueProp, default: defaultValue ?? min })`
— and `useControlled` freezes "is this controlled" into a `useRef` on the
component instance's first render. Every call site in this app always passes
`value` as an array, so this shouldn't misfire in theory, but the exact
interaction/mount-timing that flips it wasn't fully pinned down (Base UI
internals, not app code). Rather than chase the precise trigger further,
fixed this at the wrapper boundary: `slider.tsx` now wraps both
`onValueChange` and `onValueCommitted` in a small normalizer
(`Array.isArray(newValue) ? newValue : [newValue]`) before calling the
consumer's handler, so every existing `([v]) => ...` / `([min, max]) => ...`
call site (~30 of them) keeps working no matter what shape Base UI's internals
decide to hand back. This restores the exact Radix contract (`onValueChange`
always array-shaped) at the one place that needs to know about it.

## Post-migration fix: thumb border invisible (clipped by Track)

Thumbs were nested inside `Track`, matching the migration skill's literal
anatomy note (`Root > Control > Track > (Indicator, Thumb)`) — but `Track`
has `overflow-hidden` (needed to clip the filled `Indicator` to the track's
rounded pill shape). With `Thumb` as `Track`'s child, that same
`overflow-hidden` clipped each 16px thumb circle down to the track's 6px
height, hiding most of the circle and its border. The original Radix wrapper
rendered `Thumb` as a **sibling** of `Track` (both children of Root), never
subject to Track's clipping. Moved `Thumb` back out to be a sibling of
`Track` (inside `Control`) to match; confirmed via `getBoundingClientRect()`
that the thumb now renders at its full 16×16 size, unclipped.

## Post-migration fix: disabled thumb "see-through" (compounded opacity)

Disabled sliders showed the track line visibly poking through the thumb
circle. Cause: `data-disabled:opacity-50` was applied independently on
*both* `Control` (Track's ancestor) and `Thumb` — in Radix, only Root ever
actually carried the disabled data-attribute in practice, so the fade was
applied exactly once; Base UI correctly propagates `data-disabled` to every
part, so both opacities fired and multiplied (0.5 × 0.5 = 0.25 on the
thumb, only 0.5 on the track), making the already-more-transparent white
thumb let the track color show through more than intended. Fixed by moving
the fade to a single place — `Root`'s own className — and removing the
duplicate from `Control` and `Thumb`. Confirmed via computed styles: `Root`
now shows `opacity: 0.5` when disabled and is the only element with a
non-1 own-opacity; `Control`/`Thumb` inherit the fade once instead of
compounding it.

## Behavior changes

None visually — `thumbAlignment="edge"` reproduces Radix's existing look
rather than changing it.

## Verify by hand (consumer fixes, not this file)

Fixing the `Value` generic to `number[]` (see above) resolved three
compile errors that were pure type-inference artifacts, not logic bugs:
`CameraUtilities.tsx`, `controls-components.tsx` (`MobileSlider`'s
`onPointerDown/Up/Cancel` cast widened to `as any` — Base UI wraps these in
`BaseUIEvent<PointerEvent>`, adding a `preventBaseUIHandler()` method the
code never calls), and `hypsometric-tint-options-section.tsx`. All three
still receive plain `number[]` at runtime; drag a slider in each of those
three UIs (camera export resolution isn't a slider — re-check the actual
call sites if in doubt) to confirm the value still updates smoothly and
`onValueChange`/drag-to-commit still fires.

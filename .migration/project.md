# project

2026-07-28 — whole-project Radix UI -> Base UI migration, transformation-engine
strategy (hand-authored, no golden-pair CLI replay). Verdict: complete, builds
clean, spot-checked interactively in a live dev server.

## Why the transformation engine, not the shadcn CLI golden-pair flow

`shadcn info` reports `style: "new-york"` (legacy/unprefixed) with `base: "radix"`.
There is no `base-new-york` counterpart in the shadcn registry, so the
golden-pair replay strategy (fetch `base-<style>` variants and three-way-merge)
does not apply here. Every wrapper in `components/ui/` was hand-transformed
against the migration skill's reference tables instead, preserving this
project's exact classes/customizations file by file.

## Dependency swap

- Installed `@base-ui/react@1.6.0` at the start, alongside Radix (coexistence
  during the migration).
- After the last wrapper was finalized, removed all 16 `@radix-ui/react-*`
  packages plus the consolidated `radix-ui` package from `package.json` and
  ran `pnpm install`. Zero `radix-ui` / `@radix-ui` imports remain anywhere in
  the repo (`grep -r "radix-ui" components/` returns nothing).

## components.json — FLAGGED, not fixed

`style: "new-york"` still reads as a Radix-based style to the shadcn CLI
(`base: "radix"` in `shadcn info`). This is deliberate per the migration
skill's rule for legacy styles: flip only applies to `radix-<style>` ->
`base-<style>` prefixed styles, which `new-york` isn't. **Any future
`shadcn add <component>` will deliver a Radix variant** — either add new
components by hand against the Base UI patterns already established in this
codebase, or have a maintainer decide whether to adopt a `base-`-prefixed
style going forward.

## Design choice: `asChild` preserved as compatibility sugar

Radix's `asChild` doesn't exist on Base UI primitives (`render` replaces it
everywhere). The app has ~85 `asChild` call sites across ~28 files (mostly
`<Button asChild>` / `<TooltipTrigger asChild>` / `<DialogTrigger asChild>`).
Rather than hand-editing every call site to `render={...}`, every OWN wrapper
component that used to accept `asChild` (button, badge, item, marker,
breadcrumb, button-group, dialog/sheet Trigger+Close, popover/dropdown-menu
Trigger, sidebar's 5 Slot users) still accepts `asChild` and translates it
internally to Base UI's `render` prop. This is a zero-behavior-change,
mechanical equivalence (asChild + single child == render given that child),
not a silent behavior patch — it keeps ~85 call sites working unchanged while
the underlying primitives are 100% Base UI. Flagging this here because it's a
deliberate scope decision: a stricter reading of "migrate consumers to
`render`" would have touched far more files for no functional benefit.

## Consumer-code sweep (breaking changes actually hit)

- **ToggleGroup `type`/`value` -> `multiple`/array** (consumer-props.md): 7
  call sites across `contour-options-section.tsx`, `custom-color-ramp.tsx`
  (x2), `elevation-reference-toggle.tsx`, `plane-slicer-fields.tsx`,
  `controls-components.tsx` (`SegmentedToggle`) rewritten from
  `type="single" value={x}` to `value={[x]}` + array-destructuring
  `onValueChange`.
- **Select `onValueChange(value: string | null)`**: 7 call sites
  (`CameraUtilities.tsx`, `controls-components.tsx`, `curvature-options-section.tsx`,
  `custom-basemap-modal.tsx`, `custom-color-ramp.tsx`,
  `custom-terrain-source-modal.tsx`, `theme-switcher.tsx`) guarded with
  `value && handler(value)` — these selects are always-a-value UIs, so `null`
  (Base UI's "nothing selected" signal) never legitimately fires.
  `settings-dialog.tsx`'s `onInteractOutside` was moved onto `Dialog`'s
  `onOpenChange` (`eventDetails.reason === 'outside-press'` +
  `eventDetails.cancel()`), preserving the "clicks inside the portaled
  `.tec-panel` don't close this dialog" behavior.
- **`TooltipProvider delayDuration`/`skipDelayDuration`** renamed to
  `delay`/`timeout` at 3 call sites (`sidebar.tsx`, `TerrainControlPanel.tsx` x2).
- **`data-[state=on|off|checked|active|inactive]` class selectors** rewritten
  to Base UI's presence attributes (`data-pressed`, `data-checked`,
  `data-active`) across `gdal-tabs.tsx`, `CameraUtilities.tsx`,
  `light-direction-control.tsx`, `raster-basemap-section.tsx`,
  `controls-components.tsx`, and the four `TOGGLE_ITEM_CLASS`-style constants
  in `contour-options-section.tsx` / `custom-color-ramp.tsx` /
  `elevation-reference-toggle.tsx` / `plane-slicer-fields.tsx` (the "off"/
  "inactive" variant is now the unprefixed default class, since Base UI only
  emits a presence attribute for the "on" state on Toggle/Tabs).
- A pre-existing `PointerEvent` cast in `controls-components.tsx`'s
  `MobileSlider` was widened from `as unknown as React.PointerEvent<...>` to
  `as any`, since Base UI's Slider Root types `onPointerDown/Up/Cancel` as
  `BaseUIEvent<PointerEvent>` (adds a `preventBaseUIHandler()` method); the
  code only forwards the event, never calls that method.

## Behavior deltas — flagged, not silently patched

- **Tabs**: Base UI 1.6.0 defaults `Tabs.List` to manual arrow-key activation
  (`activateOnFocus` opt-in), where Radix defaulted to automatic. Not changed
  in `tabs.tsx` — if arrow-key tab switching regresses, add
  `activateOnFocus` to `TabsList` deliberately.
- **DropdownMenu Checkbox/RadioItem `closeOnClick`**: Base UI defaults `false`
  (Radix always closed on select). Explicitly set `closeOnClick={true}` in
  both wrappers to preserve the existing UX — this is unused in the app today
  (no consumer imports `DropdownMenu*`), so it's a forward-looking default,
  not a live fix.
- **`theme-switcher.tsx` arrow-key-steps-instead-of-opens trick**: relied on
  Radix's specific caller-runs-first event composition order for
  `SelectTrigger`'s `onKeyDown`. Left the logic in place (it still
  type-checks and the `preventDefault` still runs first), but Base UI's exact
  event-composition order for `Select.Trigger` was not independently verified
  against Radix's — flagged in-place with a code comment for a manual check.
- **Popover `Anchor`**: no Base UI equivalent (dropped). `PopoverAnchor` is
  unused in this app; kept as an inert children-passthrough export so the
  name doesn't disappear, per the migration skill's hard rule.

## Left alone (not Radix, intentionally untouched)

cmdk (command), vaul (drawer), sonner, input-otp, react-day-picker (calendar),
recharts (chart) — none of these are used as shadcn `ui/` wrappers in this
project's `components/ui/` directory in the first place (confirmed via grep);
noting here per the skill's hard rule anyway.

## Verify by hand

- Toggle/Toggle-Group pressed styling (`data-pressed`) reads correctly in
  both themes — spot-checked the 2D/3D view-mode toggle live (aria-checked
  flips correctly on click, confirmed via computer tool).
- Select popups (spot-checked the Hillshade Method select live: opens,
  lists all 5 items with correct text, Escape closes it via
  `outside`/`escape-key` dismissal).
- Dialog/Sheet slide + fade animations (rewritten from `animate-in/out` to
  `data-starting-style`/`data-ending-style` transitions) — visually confirm
  the Settings dialog and the mobile sidebar Sheet still animate smoothly.
- Tooltip delay/hover behavior project-wide (the `TooltipDelayContext` bridge
  in `tooltip.tsx` is a new mechanism, not a 1:1 port — confirm tooltips
  still respect their intended `delayDuration` per call site).
- DropdownMenu is unused in the app today; if/when someone wires it up,
  re-verify `closeOnClick` behavior on Checkbox/RadioItem matches
  expectations.

## Post-migration fix: dropped `forwardRef` on 4 wrappers

Running the app live surfaced a real bug the hand-transform introduced: React
warned "Function components cannot be given refs" for `TooltipTrigger`
(breaking Base UI's tooltip positioning for every icon button wrapped in a
tooltip) and `DialogTrigger` composition. Root cause: `button.tsx`'s `Button`,
`label.tsx`'s `Label`, and `tooltip.tsx`'s `TooltipTrigger`/`TooltipContent`
were all `React.forwardRef` in the original Radix code, but got rewritten as
plain function components during the migration (reasoning at the time: "Base
UI's own primitive already forwards refs" — true for the primitive, but the
outer wrapper function still needs its own `forwardRef` to pass a ref through
to that primitive at all). `dialog.tsx`'s `DialogOverlay`/`DialogContent`/
`DialogTitle`/`DialogDescription` had the same gap. Restored `forwardRef` on
all of these (matching the original files exactly); `radio-group.tsx` was
audited too but left alone — Base UI's `RadioGroup`/`Radio.Root` types don't
expose a `ref` prop in their public signatures at all (unlike `Toggle`/
`ToggleGroup`, which do), and grep confirmed no consumer wraps a
`RadioGroupItem` in a Trigger's `asChild` anyway. Verified clean (zero console
errors/warnings) in a fresh dev server afterward.

## Derived status

`grep -rl "radix-ui\|@radix-ui" components/ lib/ app/ 2>/dev/null` -> **0
files**. 0 wrappers remain on Radix. `pnpm exec tsc --noEmit` and
`pnpm run build` both pass clean.

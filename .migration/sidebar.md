# sidebar

2026-07-28, transformation engine, verdict: last file migrated (depends on
sheet/tooltip/separator/button, all already-migrated by this point). Five
`Slot` usages converted to `useRender`/`mergeProps`; one `TooltipProvider`
prop-rename fix inline.

## Changed

- [components/ui/sidebar.tsx](../components/ui/sidebar.tsx): five components
  used the `const Comp = asChild ? Slot : <tag>` idiom —
  `SidebarGroupLabel` (div), `SidebarGroupAction` (button),
  `SidebarMenuButton` (button, plus its `tooltip` prop composition with
  `Tooltip`/`TooltipTrigger`/`TooltipContent`), `SidebarMenuAction` (button),
  `SidebarMenuSubButton` (a) — all converted to `useRender` + `mergeProps`
  with the matching `defaultTagName`, same `asChild` shim pattern used
  throughout this migration. `SidebarMenuButton` additionally composes with
  the already-migrated `Tooltip`/`TooltipTrigger` (`<TooltipTrigger
  asChild>{button}</TooltipTrigger>` continues to work unchanged since
  `TooltipTrigger` itself now carries the same shim). `TooltipProvider
  delay={0}` (was `delayDuration={0}`) in `SidebarProvider` — fixed as part
  of the tooltip.tsx prop rename, not a new decision made here.
- Leftover scan: clean.

## Left alone

`Sidebar`, `SidebarTrigger` (uses the already-migrated `Button`),
`SidebarRail`, `SidebarInset`, `SidebarInput` (uses `Input`, non-Radix),
`SidebarHeader`, `SidebarFooter`, `SidebarSeparator` (re-exports
`Separator`), `SidebarContent`, `SidebarGroup`, `SidebarGroupContent`,
`SidebarMenu`, `SidebarMenuItem`, `SidebarMenuBadge`, `SidebarMenuSkeleton`
(uses `Skeleton`, non-Radix), `SidebarMenuSub`, `SidebarMenuSubItem` — all
plain elements, never used Radix.

## Behavior changes

None expected.

## Notes on the mobile `<Sheet {...props}>` spread

`Sidebar`'s mobile branch does `<Sheet open={openMobile}
onOpenChange={setOpenMobile} {...props}>` where `props` is typed as
`React.ComponentProps<'div'>` (from the outer `Sidebar` function's own prop
type) minus the destructured keys — i.e. it spreads arbitrary leftover div
props onto `Sheet`'s Dialog-Root wrapper. This compiled cleanly both before
and after the migration (TS doesn't excess-property-check spread
expressions), and since `Sheet`/`Dialog.Root` render no DOM element of their
own, any stray non-Dialog props in that spread are silently dropped by
React at runtime either way — pre-existing quirk, not something this
migration introduced or needed to fix.

## Verify by hand

- Desktop: hover a sidebar menu item with a `tooltip` prop while the
  sidebar is collapsed to icon-only mode — the tooltip should appear on the
  right, confirming the `SidebarMenuButton` + `Tooltip` composition still
  works through the `useRender` rewrite.
- Mobile (narrow viewport): open/close the sidebar and confirm it still
  renders as a slide-in `Sheet` from the correct side.

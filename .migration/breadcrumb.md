# breadcrumb

2026-07-28, transformation engine, verdict: clean `useRender`/`mergeProps`
swap — this is the exact worked example from the migration skill's reference
docs (`BreadcrumbLink`), applied as-is.

## Changed

- [components/ui/breadcrumb.tsx](../components/ui/breadcrumb.tsx):
  `BreadcrumbLink`'s `const Comp = asChild ? Slot : 'a'` replaced with
  `useRender` + `mergeProps`, `defaultTagName: 'a'`. `Breadcrumb`,
  `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbPage`, `BreadcrumbSeparator`,
  `BreadcrumbEllipsis` are all plain elements with no Radix dependency —
  untouched.
- Leftover scan: clean.

## Left alone

`Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbPage`,
`BreadcrumbSeparator`, `BreadcrumbEllipsis`.

## Behavior changes

None.

## Verify by hand

- Any `<BreadcrumbLink asChild>` wrapping a router `<Link>` still navigates
  and shows the link's hover-underline styling.

import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from '@/components/mermaid';

// Static asset paths (as opposed to other docs pages) are authored
// root-relative from the main app's perspective, e.g.
// /maplibre-raster-dem-wms-float32-generic.html in credits.mdx — a file the
// main app itself serves from its own public/, not a docs route. Every real
// docs page link is extension-less, so this only ever matches those asset
// hrefs. fumadocs-ui's default `a` wraps root-relative hrefs in next/link,
// which prepends this app's basePath ("/docs") — wrong for a path that's
// meant to escape the docs subtree entirely, so those get a plain,
// untouched anchor instead.
const STATIC_ASSET_RE = /\.[a-z0-9]+$/i

const DefaultA = defaultMdxComponents.a;
const DefaultImg = defaultMdxComponents.img;

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    a: ({ href, ...props }: any) =>
      typeof href === 'string' && href.startsWith('/') && STATIC_ASSET_RE.test(href)
        ? <a href={href} {...props} />
        : <DefaultA href={href} {...props} />,
    // Marks every prose image click-to-open in the page's shared
    // LightboxProvider (see [...slug]/page.tsx and lightbox.tsx) — looping
    // left/right arrow-key navigation across all images on the page.
    img: (props: any) => (
      <DefaultImg
        {...props}
        data-lightbox=""
        className={[props.className, 'cursor-zoom-in'].filter(Boolean).join(' ')}
      />
    ),
    Mermaid,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

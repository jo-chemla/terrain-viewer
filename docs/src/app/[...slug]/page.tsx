import { getPageImageUrl, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { LightboxProvider } from '@/components/lightbox';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { gitConfig } from '@/lib/shared';
import { StudioLink } from '@/components/studio-link';
import { changelogToc } from '@/components/changelog-list';

export default async function Page(props: PageProps<'/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // Without the base path: the stock buttons add it themselves through
  // import.meta.env.BASE_URL, which Next's Turbopack derives from basePath
  // since 16.3 (vercel/next.js#96225). Prefixing it here, as the site did from
  // 2026-08-20 to 2026-10-14 with a copy of the popover, made the Copy
  // Markdown fetch /docs/docs/llms.mdx/... once that Next shipped.
  // Checked 2026-10-14 on the static export: both buttons carry /docs once.
  const markdownUrl = getPageMarkdownUrl(page).url;
  // The changelog's entries come from CHANGELOG.md at build time, not from
  // MDX headings, so its right-hand ToC is built from the same file.
  const toc = params.slug.join('/') === 'changelog' ? changelogToc() : page.data.toc;

  return (
    <DocsPage toc={toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          // The docs app lives in the repo's docs/ SUBDIRECTORY — page.path
          // is relative to content/docs inside it, so the blob URL needs the
          // docs/ prefix (this isn't a fumadocs setting: fumadocs never sees
          // the repo layout, the URL is assembled right here).
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/docs/content/docs/${page.path}`}
        />
        <StudioLink path={page.path} />
      </div>
      <DocsBody>
        <LightboxProvider>
          <MDX
            components={getMDXComponents({
              // this allows you to link to other pages with relative file paths
              a: createRelativeLink(source, page),
            })}
          />
        </LightboxProvider>
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

// Pages whose one address is on the historical host. Every other page is
// canonical on terrain-viewer.iconem.com (metadataBase). The build is the
// same for both hosts, so this is a property of the page, not of the deploy:
// both copies name the same address, and no per-repository setting exists.
// Listed here: pages Google ranks on the historical host for what people
// search there (Search Console, 2026-11: "google earth timelapse").
const HISTORICAL_HOST_PAGES = new Set(['dev/google-timelapse']);

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    // One address per page for search engines, whichever domain served it
    // (the same export is on the GitHub Pages mirror and the historical
    // domain). Relative to metadataBase (layout.tsx).
    alternates: { canonical: `${HISTORICAL_HOST_PAGES.has(params.slug.join('/')) ? 'https://historical-satellite.iconem.com/docs/' : ''}${params.slug.join('/')}/` },
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}

import { getPageImageUrl, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { LightboxProvider } from '@/components/lightbox';
import { DocsViewOptions } from '@/components/page-actions';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { docsBasePath, gitConfig } from '@/lib/shared';
import { changelogToc } from '@/components/changelog-list';

export default async function Page(props: PageProps<'/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // basePath-prefixed here, once: fumadocs' MarkdownCopyButton fetches this
  // verbatim (its withBasePath() is a no-op under Next — it reads Vite's
  // import.meta.env, see page-actions.tsx), and DocsViewOptions (our
  // basePath-aware ViewOptionsPopover replacement, same file) links it as
  // "View as Markdown". Without the prefix both resolved to the
  // non-existent un-prefixed /llms.mdx/... path in the deployed export.
  const markdownUrl = docsBasePath + getPageMarkdownUrl(page).url;
  // The changelog's entries come from CHANGELOG.md at build time, not from
  // MDX headings, so its right-hand ToC is built from the same file.
  const toc = params.slug.join('/') === 'changelog' ? changelogToc() : page.data.toc;

  return (
    <DocsPage toc={toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <DocsViewOptions
          markdownUrl={markdownUrl}
          // The docs app lives in the repo's docs/ SUBDIRECTORY — page.path
          // is relative to content/docs inside it, so the blob URL needs the
          // docs/ prefix (this isn't a fumadocs setting: fumadocs never sees
          // the repo layout, the URL is assembled right here).
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/docs/content/docs/${page.path}`}
        />
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

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}

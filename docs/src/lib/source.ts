import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/plugins/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import type { LoaderPlugin } from 'fumadocs-core/source';

// `sidebarTitle` in a page's frontmatter is the short name the sidebar and
// the breadcrumbs show; `title` stays the long one for the <title> tag, the
// H1, the search index and the Open Graph image, where the extra words
// earn clicks. Without it the sidebar wraps a 90-character title over
// three lines.
const pageSchemaWithSidebarTitle = pageSchema.extend({
  sidebarTitle: z.string().optional(),
});

function sidebarTitlePlugin(): LoaderPlugin {
  return {
    name: 'terrain-viewer:sidebar-title',
    transformPageTree: {
      file(node, filePath) {
        if (!filePath) return node;
        const file = this.storage.read(filePath);
        const short = file?.format === 'page' ? (file.data as { sidebarTitle?: unknown }).sidebarTitle : undefined;
        if (typeof short === 'string' && short) node.name = short;
        return node;
      },
    },
  };
}

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchemaWithSidebarTitle,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  // `icon: <LucideName>` in a page's frontmatter draws that icon before its
  // sidebar entry, outline and in the text colour.
  plugins: [lucideIconsPlugin(), sidebarTitlePlugin()],
});

export function getPageImageUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: '/' + [page.locale, ...docsImageRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: '/' + [page.locale, ...docsContentRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}

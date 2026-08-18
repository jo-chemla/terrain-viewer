import { defineConfig } from 'fumadocs-mdx/config';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Passing plain arrays (not functions) here ADDS to fumadocs-mdx's own
// default remark/rehype plugin list (remarkGfm, remarkHeading, rehypeCode,
// ...) rather than replacing it — see applyMdxPreset in
// node_modules/fumadocs-mdx/dist/remark-include-*.js: `pluginOption` only
// throws the defaults away when a collection's OWN `mdxOptions` is set to a
// raw ProcessorOptions (bypassing the preset entirely); this global,
// preset-shaped `mdxOptions` instead splices `v` (our array) into the
// existing default plugin pipeline.
export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid, remarkMath],
    // Must run BEFORE rehypeCode (Shiki): remark-math's `math`/`inlineMath`
    // nodes reach the hast tree as plain <code class="language-math"> (no
    // handler registered for them), and rehypeCode throws ("Language `math`
    // not found") if it sees one before rehype-katex has replaced it with
    // real KaTeX markup. A plain array here gets spliced in AFTER rehypeCode
    // (see applyMdxPreset's fixed [rehypeCodeOptions, ...v, rehypeToc]
    // ordering) — the function form instead receives the full default list
    // and can prepend ahead of it.
    rehypePlugins: (defaults) => [rehypeKatex, ...defaults],
  },
});

// Strips a leading MDX frontmatter block ("---\n...\n---\n") from raw file
// text imported via `?raw` — the docs/content/docs/*.mdx files under this
// repo are the single source of truth for keyboard shortcuts, resource
// links, and credits: Fumadocs renders them as real docs pages, and this
// same raw text (minus the frontmatter Fumadocs needs but react-markdown
// doesn't) is what the Settings dialog renders inline.
// \r?\n (not a bare \n) — these files have CRLF line endings on disk
// (Windows checkout); a literal \n-only pattern silently fails to match,
// leaving the raw "title: ...\ndescription: ..." frontmatter rendered as text.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/
// Strips the "single source of truth" explainer comment each shared file
// carries for whoever's reading the raw .mdx — meaningless once rendered.
// MDX only accepts JSX-style comments ({/* ... */}), not HTML's <!-- -->
// (Fumadocs' MDX compiler errors on the latter), so that's the only syntax
// these files ever use.
const MDX_COMMENT_RE = /\{\/\*[\s\S]*?\*\/\}/g

export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_RE, "").replace(MDX_COMMENT_RE, "").trim()
}

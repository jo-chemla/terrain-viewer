import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Single source of truth: features/visualization-modes-description.mdx —
// also imported raw by the app's own Settings dialog (see
// settings-dialog.tsx's VISUALIZATION_MODES_DESCRIPTION_MARKDOWN). Read here
// via fs rather than a normal MDX import so both surfaces render the exact
// same source text through their own markdown pipeline instead of two
// independently-compiled copies drifting apart.
// \r?\n (not a bare \n) — this file has CRLF line endings on disk (Windows
// checkout), and a literal \n-only pattern silently fails to match, leaving
// the raw "title: ...\ndescription: ..." frontmatter block rendered as text.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const MDX_COMMENT_RE = /\{\/\*[\s\S]*?\*\/\}/g;

const markdownComponents = {
  h3: ({ children }: any) => <h3 className="text-base font-semibold mt-6">{children}</h3>,
  h4: ({ children }: any) => <h4 className="text-xs font-semibold text-fd-muted-foreground uppercase tracking-wide mt-4">{children}</h4>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 space-y-1 text-sm">{children}</ul>,
  code: ({ children }: any) => <code className="bg-fd-muted px-1 rounded text-xs">{children}</code>,
};

export function VisualizationModesDescription() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "content/docs/features/visualization-modes-description.mdx"),
    "utf-8",
  );
  const body = raw.replace(FRONTMATTER_RE, "").replace(MDX_COMMENT_RE, "").trim();
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {body}
    </ReactMarkdown>
  );
}

import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// CHANGELOG.md lives at the repo root (one level up from docs/), and is the
// single source of truth the app's own Settings dialog parses too — see
// lib/changelog.ts there. This mirrors that regex, but only ever surfaces
// the heading/date/TL;DR — never the Features/Bug Fixes prose below it,
// which is written for dev-me, not docs readers.
const HEADING_RE = /^# Changelog(?:\s*—\s*(.+))?\s*$/gm;
const RELEASED_RE = /<!--\s*released:\s*(\S+?)\s*-->/;
const TLDR_RE = /^#### TL;DR\s*\n([\s\S]*?)(?=\n#{1,4} |(?![\s\S]))/m;

interface ChangelogEntry {
  heading: string;
  releasedDate: string;
  tldrMarkdown: string;
}

function normalizeTldr(tldr: string): string {
  return tldr.startsWith("- ") ? tldr : `- ${tldr}`;
}

function parseChangelog(text: string): ChangelogEntry[] {
  const headingMatches = [...text.matchAll(HEADING_RE)];
  return headingMatches.map((match, i) => {
    const start = match.index ?? 0;
    const end = i + 1 < headingMatches.length ? (headingMatches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end);
    const heading = (match[1] ?? "").trim();
    const releasedMatch = body.match(RELEASED_RE);
    const tldrMatch = body.match(TLDR_RE);
    const releasedAt = releasedMatch ? releasedMatch[1] : "";
    return {
      heading,
      releasedDate: releasedAt.slice(0, 10),
      tldrMarkdown: tldrMatch ? normalizeTldr(tldrMatch[1].trim()) : "",
    };
  });
}

const markdownComponents = {
  ul: ({ children }: any) => <ul className="list-disc pl-4 space-y-1.5 text-sm text-fd-muted-foreground">{children}</ul>,
  strong: ({ children }: any) => <strong className="font-semibold text-fd-foreground">{children}</strong>,
  code: ({ children }: any) => <code className="bg-fd-muted px-1 rounded text-xs">{children}</code>,
  a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
  // eslint-disable-next-line @next/next/no-img-element
  img: ({ src, alt }: any) => <img src={src} alt={alt} className="rounded border max-w-full my-2" />,
};

export function ChangelogList() {
  const raw = fs.readFileSync(path.join(process.cwd(), "..", "CHANGELOG.md"), "utf-8");
  const entries = parseChangelog(raw).filter((e) => e.tldrMarkdown);

  return (
    <div className="space-y-8">
      {entries.map((entry) => (
        <div key={entry.releasedDate + entry.heading}>
          <h3 className="text-base font-semibold">
            <span className="text-fd-muted-foreground font-normal mr-2">{entry.releasedDate}</span>
            {entry.heading}
          </h3>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {entry.tldrMarkdown}
          </ReactMarkdown>
        </div>
      ))}
    </div>
  );
}

"use client";

// A dev-only "Edit in Studio" link next to the page actions: Fumadocs Studio
// (pnpm docs starts it on 5180 beside next dev; NEXT_PUBLIC_STUDIO_PORT for a
// worktree on another port) edits content/docs visually and addresses a page
// by its file path in the URL hash. Only on a localhost docs server; the
// published site never shows it.
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

export function StudioLink({ path }: { path: string }) {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    if (/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) setHost(window.location.hostname);
  }, []);
  if (!host) return null;
  const port = process.env.NEXT_PUBLIC_STUDIO_PORT ?? "5180";
  return (
    <a
      href={`http://${host}:${port}/#${path}`}
      target="_blank"
      rel="noreferrer"
      title="Open this page in Fumadocs Studio (dev only)"
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent"
    >
      <Pencil className="size-3.5" /> Edit in Studio
    </a>
  );
}

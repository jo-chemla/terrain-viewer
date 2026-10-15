"use client";

// "Edit in Studio", next to the page actions on a localhost docs server:
// Fumadocs Studio (pnpm docs starts it on 5180 beside next dev; a worktree
// runs it on another port) edits content/docs visually and addresses a page
// by its file path in the URL hash. The button only appears when a Studio
// answers on one of the candidate ports (NEXT_PUBLIC_STUDIO_PORT first, then
// 5180 to 5183), probed with a no-cors fetch: an opaque response means a
// server is there, a network error means none. Never on the published site.
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { cn } from "@/lib/cn";

const PORTS = [process.env.NEXT_PUBLIC_STUDIO_PORT, "5180", "5181", "5182", "5183"].filter((p): p is string => !!p);

export function StudioLink({ path }: { path: string }) {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    const host = window.location.hostname;
    if (!/^(localhost|127\.0\.0\.1)$/.test(host)) return;
    let cancelled = false;
    (async () => {
      for (const port of PORTS) {
        const url = `http://${host}:${port}/`;
        try {
          await fetch(url, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(1500) });
          if (!cancelled) setBase(url);
          return;
        } catch {
          /* nothing on that port */
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!base) return null;
  return (
    <a
      href={`${base}#${path}`}
      target="_blank"
      rel="noreferrer"
      title="Open this page in Fumadocs Studio (dev only)"
      className={cn(buttonVariants({ variant: "secondary", size: "sm", className: "gap-2 [&_svg]:size-3.5 [&_svg]:text-fd-muted-foreground" }))}
    >
      <Pencil /> Edit in Studio
    </a>
  );
}

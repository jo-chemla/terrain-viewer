"use client";

// The app, from the sidebar's title row: a small mountain button placed
// before the "Terrain Viewer" title. The title itself is Fumadocs' link to
// the docs root, so this is a button (an anchor inside that link would be
// invalid HTML) that opens the host's root in a new tab and stops the click
// from reaching the title link. The header's icon link (layout.shared.tsx)
// does the same from the top bar.
import { Mountain } from "lucide-react";

export function AppIconButton() {
  return (
    <button
      type="button"
      title="Open the app"
      aria-label="Open the app"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open("/", "_blank", "noopener"); }}
      className="mr-1.5 inline-flex size-6 items-center justify-center rounded-md border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent"
    >
      <Mountain className="size-3.5" />
    </button>
  );
}

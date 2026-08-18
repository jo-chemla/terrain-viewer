'use client';

import { useEffect, useRef, useState } from 'react';

// remarkMdxMermaid (see source.config.ts) turns ```mermaid fences into
// <Mermaid chart="..."> — fumadocs-ui doesn't ship a renderer for it in this
// version, so this is a from-scratch client component. mermaid.js renders to
// SVG using real browser DOM APIs, so this only works client-side (dynamic
// import, useEffect) even though the site is otherwise statically exported.
function useIsDark() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

let mermaidIdCounter = 0;

export function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++mermaidIdCounter}`);
  const isDark = useIsDark();

  useEffect(() => {
    let cancelled = false;
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'neutral',
        securityLevel: 'strict',
        fontFamily: 'inherit',
      });
      const { svg } = await mermaid.render(idRef.current, chart);
      if (!cancelled) setSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [chart, isDark]);

  if (!svg) {
    return (
      <div className="my-4 animate-pulse rounded-lg border bg-fd-muted/40 p-8 text-center text-sm text-fd-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  // eslint-disable-next-line react/no-danger -- mermaid's own SVG output, not user input
  return <div className="my-4 flex justify-center overflow-x-auto rounded-lg border bg-fd-card p-4 [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

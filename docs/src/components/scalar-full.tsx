'use client';

import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useEffect, useState } from 'react';

// The code blocks of the descriptions (the quick start's addresses) wrap and
// get a copy button, as on the service's own /docs page
// (tile-server/openapi.mjs CODE_BLOCK_CSS): Scalar gives them neither.
const CODE_BLOCK_CSS = `.markdown pre{position:relative;white-space:pre-wrap;overflow-wrap:anywhere;padding-right:4.75em}
.markdown pre code{white-space:pre-wrap !important;overflow-wrap:anywhere;overflow:visible !important}
.markdown pre .tv-copy{position:absolute;top:6px;right:6px;font:inherit;font-size:12px;line-height:1;padding:5px 8px;border-radius:4px;border:1px solid var(--scalar-border-color,#ccc);background:var(--scalar-background-1,#fff);color:var(--scalar-color-1,#222);cursor:pointer;opacity:.85}
.markdown pre .tv-copy:hover,.markdown pre .tv-copy:focus-visible{opacity:1}`;

function useSiteDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains('dark'));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Adds a Copy button to every description code block Scalar renders. */
function useCopyButtons() {
  useEffect(() => {
    const add = () => {
      document.querySelectorAll<HTMLPreElement>('.markdown pre:not([data-tv-copy])').forEach((pre) => {
        pre.setAttribute('data-tv-copy', '');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tv-copy';
        b.textContent = 'Copy';
        b.setAttribute('aria-label', 'Copy to the clipboard');
        b.onclick = () => {
          const text = (pre.querySelector('code') ?? pre).textContent?.trim() ?? '';
          void navigator.clipboard.writeText(text).then(() => {
            b.textContent = 'Copied';
            setTimeout(() => (b.textContent = 'Copy'), 1500);
          });
        };
        pre.appendChild(b);
      });
    };
    add();
    const observer = new MutationObserver(add);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

// The tile service's reference over the whole width, as the service's own
// /docs page shows it (modern layout, sidebar, every tag open), over the
// docs copy of its OpenAPI document. Light or dark follows the site.
export function ScalarFull({ url }: { url: string }) {
  const dark = useSiteDark();
  useCopyButtons();
  return (
    <ApiReferenceReact
      key={dark ? 'dark' : 'light'}
      configuration={{
        url,
        hideDarkModeToggle: true,
        darkMode: dark,
        forceDarkModeState: dark ? 'dark' : 'light',
        defaultOpenAllTags: true,
        customCss: CODE_BLOCK_CSS,
      }}
    />
  );
}

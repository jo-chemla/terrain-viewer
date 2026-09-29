'use client';
import { useEffect } from "react";

// Makes every "##" section of the page it is placed on foldable: a chevron
// before each h2 hides or shows everything down to the next h2. Fumadocs has
// no foldable sections of its own (its Accordions would take the headings out
// of the table of contents). Everything stays in the page and in the TOC; a
// TOC link or a #hash into a folded section unfolds it first. Folding is
// per visit, not remembered.
export function FoldableSections() {
  useEffect(() => {
    const article = document.querySelector("#nd-page");
    const prose = article?.querySelector(".prose") ?? article;
    if (!prose) return;
    const headings = Array.from(prose.querySelectorAll(":scope > h2"));
    const cleanups: (() => void)[] = [];

    const bodyOf = (h: Element) => {
      const out: HTMLElement[] = [];
      for (let n = h.nextElementSibling; n && n.tagName !== "H2"; n = n.nextElementSibling) out.push(n as HTMLElement);
      return out;
    };
    const setFolded = (h: Element, button: HTMLButtonElement, folded: boolean) => {
      for (const el of bodyOf(h)) el.hidden = folded;
      button.setAttribute("aria-expanded", String(!folded));
      button.style.transform = folded ? "rotate(-90deg)" : "";
    };

    const buttons = new Map<Element, HTMLButtonElement>();
    for (const h of headings) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "⌄";
      button.title = "Fold or unfold this section";
      button.setAttribute("aria-expanded", "true");
      button.className = "tv-fold mr-1.5 inline-flex size-6 items-center justify-center rounded align-middle text-base leading-none text-fd-muted-foreground transition-transform hover:bg-fd-accent hover:text-fd-foreground";
      button.addEventListener("click", (e) => {
        e.preventDefault();
        setFolded(h, button, button.getAttribute("aria-expanded") === "true");
      });
      h.prepend(button);
      buttons.set(h, button);
      cleanups.push(() => { button.remove(); for (const el of bodyOf(h)) el.hidden = false; });
    }

    // A link to something inside a folded section unfolds that section.
    const reveal = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      for (const [h, button] of buttons) {
        if (h === target || bodyOf(h).some((el) => el === target || el.contains(target))) {
          if (button.getAttribute("aria-expanded") === "false") {
            setFolded(h, button, false);
            requestAnimationFrame(() => target.scrollIntoView());
          }
        }
      }
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a[href^="#"]');
      if (a) setTimeout(reveal, 0);
    };
    window.addEventListener("hashchange", reveal);
    document.addEventListener("click", onClick);
    cleanups.push(() => { window.removeEventListener("hashchange", reveal); document.removeEventListener("click", onClick); });
    return () => cleanups.forEach((c) => c());
  }, []);
  return null;
}

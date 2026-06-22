'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TocItem {
  id: string;
  text: string;
}

/**
 * S19.2 — table of contents for the long legal pages (privacy 8 sections,
 * ai-disclosure 9). Progressive enhancement, zero page restructure: on mount it
 * reads the sibling `<article>`'s `<h2>`s, slugifies a stable `id` + a
 * `scroll-margin-top` (so an anchor never lands under a sticky header), and
 * renders a native `<nav><ul>` of anchors. Active section tracked via
 * IntersectionObserver → `aria-current="location"` on exactly one link
 * (research: w3.org aria-current, css-tricks sticky TOC).
 *
 * Closed `<details>` by default = the recommended mobile pattern for long
 * legal/consent pages (a sticky sidebar fights the virtual keyboard / wastes
 * width) AND keeps the rendered height stable (summary only) so inserting it
 * after mount causes no content shift beyond the ~44px accordion bar. Hidden
 * entirely under 3 sections (short pages don't need it). Reduced-motion safe
 * (the only motion is the native marker rotation, gated below).
 */
export function LegalToc() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    // Read the article's headings AFTER paint (rAF callback, not the effect
    // body) so the setState isn't a synchronous in-effect call
    // (react-hooks/set-state-in-effect) and the DOM the prose rendered is ready.
    let observer: IntersectionObserver | null = null;
    const raf = requestAnimationFrame(() => {
      const article = document.querySelector('article[data-legal-body]');
      if (!article) return;
      const headings = Array.from(article.querySelectorAll('h2'));
      const next: TocItem[] = [];
      for (const h of headings) {
        const text = (h.textContent || '').trim();
        if (!text) continue;
        if (!h.id) {
          h.id = text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .slice(0, 48);
        }
        h.style.scrollMarginTop = '5rem';
        next.push({ id: h.id, text });
      }
      setItems(next);

      if (next.length < 3) return;
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible[0]) setActiveId((visible[0].target as HTMLElement).id);
        },
        { rootMargin: '-80px 0px -70% 0px' },
      );
      headings.forEach((h) => observer!.observe(h));
    });
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, []);

  if (items.length < 3) return null;

  return (
    <nav aria-label="Sommaire" className="mb-5">
      <details className="legal-toc group rounded-xl border border-[var(--b-default)] bg-[var(--bg-1)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-[13px] font-semibold text-[var(--t-1)] transition-colors hover:bg-[var(--bg-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]">
          Sommaire
          <ChevronDown
            className="h-4 w-4 text-[var(--t-3)] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </summary>
        <ul className="flex flex-col gap-0.5 border-t border-[var(--b-subtle)] px-2 py-2">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                aria-current={activeId === it.id ? 'location' : undefined}
                className="block rounded-md px-2 py-1.5 text-[13px] leading-snug text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] aria-[current]:bg-[var(--acc-dim)] aria-[current]:font-medium aria-[current]:text-[var(--acc-hi)]"
              >
                {it.text}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

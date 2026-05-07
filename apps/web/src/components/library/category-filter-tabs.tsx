import Link from 'next/link';

import { Pill } from '@/components/ui/pill';
import type { DouglasCategory } from '@/generated/prisma/enums';
import { cn } from '@/lib/utils';

import { CATEGORY_ICON, CATEGORY_LABEL } from './category-meta';

interface CategoryEntry {
  category: DouglasCategory;
  count: number;
}

interface CategoryFilterTabsProps {
  /** All available (category, count) pairs. */
  entries: CategoryEntry[];
  /** Currently selected category, or null for "all". */
  active: DouglasCategory | null;
  /** Total cards across all categories (used for the "all" tab). */
  totalCount: number;
}

/**
 * Sticky filter strip on `/library`. Server Component — each tab is a `<Link>`
 * that pushes a search-param URL. We deliberately do NOT use radix Tabs here
 * because the navigation is true-route-state, not in-page state.
 *
 * Mobile-first: horizontal scroll on iPhone SE (375px). On md+ it wraps to
 * 2-3 lines. `aria-current="page"` marks the active tab for SR users.
 */
export function CategoryFilterTabs({ entries, active, totalCount }: CategoryFilterTabsProps) {
  const tabClass = (selected: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-sm transition-all',
      'min-h-11 whitespace-nowrap',
      selected
        ? 'border-acc/60 bg-acc/15 text-acc shadow-[0_0_0_1px_var(--b-acc)]'
        : 'border-border bg-bg-1 text-foreground/85 hover:border-strong hover:bg-bg-2',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc',
    );

  return (
    <nav aria-label="Filtres par thème" className="-mx-4 overflow-x-auto px-4 py-1 md:mx-0 md:px-0">
      <ul className="flex gap-2 md:flex-wrap">
        <li>
          <Link
            href="/library"
            aria-current={active === null ? 'page' : undefined}
            className={tabClass(active === null)}
          >
            <span>Tout</span>
            <Pill tone={active === null ? 'acc' : 'mute'}>{totalCount}</Pill>
          </Link>
        </li>
        {entries.map((e) => {
          const Icon = CATEGORY_ICON[e.category];
          return (
            <li key={e.category}>
              <Link
                href={`/library?cat=${e.category}`}
                aria-current={active === e.category ? 'page' : undefined}
                className={tabClass(active === e.category)}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span>{CATEGORY_LABEL[e.category]}</span>
                <Pill tone={active === e.category ? 'acc' : 'mute'}>{e.count}</Pill>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

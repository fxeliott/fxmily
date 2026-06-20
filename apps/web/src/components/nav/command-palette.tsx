'use client';

import { CornerDownLeft, Moon, Plus, Search, Sun, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { NAV_GROUPS } from './nav-items';

/**
 * CommandPalette (S11) — ⌘K / Ctrl+K quick navigation across every route + a few
 * quick actions. Built on the Radix Dialog primitive (focus-trap, Escape, scroll
 * lock) + a hand-rolled accessible combobox/listbox (role-gated, accent-
 * insensitive filter, full keyboard control). No new dependency.
 *
 * A11y: input is role="combobox" with aria-activedescendant pointing at the
 * highlighted role="option"; ↑/↓ move the active row, Enter navigates, Esc
 * closes. Opened by ⌘K (mac) / Ctrl+K, or the visible triggers in the shell
 * (so touch users without a keyboard can reach it too).
 */

interface CmdItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

const QUICK_ACTIONS: readonly CmdItem[] = [
  { href: '/journal/new', label: 'Nouveau trade', icon: Plus, group: 'Actions rapides' },
  { href: '/checkin/morning', label: 'Check-in du matin', icon: Sun, group: 'Actions rapides' },
  { href: '/checkin/evening', label: 'Check-in du soir', icon: Moon, group: 'Actions rapides' },
];

/** Accent- and case-insensitive normalise so "reunion" matches "Réunions". */
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function CommandPalette({
  isAdmin,
  open,
  onOpenChange,
}: {
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems = useMemo<CmdItem[]>(() => {
    const nav = NAV_GROUPS.filter((g) => !g.admin || isAdmin).flatMap((g) =>
      g.items
        .filter((it) => !it.admin || isAdmin)
        .map((it) => ({
          href: it.href,
          label: it.label,
          icon: it.icon,
          group: g.label ?? 'Général',
        })),
    );
    return [...QUICK_ACTIONS, ...nav];
  }, [isAdmin]);

  const filtered = useMemo<CmdItem[]>(() => {
    const q = norm(query.trim());
    if (!q) return allItems;
    return allItems.filter((it) => norm(it.label).includes(q));
  }, [allItems, query]);

  // Preserve filtered order while grouping for display.
  const groups = useMemo<[string, CmdItem[]][]>(() => {
    const map = new Map<string, CmdItem[]>();
    for (const it of filtered) {
      const arr = map.get(it.group);
      if (arr) arr.push(it);
      else map.set(it.group, [it]);
    }
    return [...map.entries()];
  }, [filtered]);

  // Close+reset in one event handler (avoids setState-in-effect): closing the
  // palette clears the query and the active row.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setQuery('');
        setActive(0);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Global ⌘K / Ctrl+K toggle (deliberate modifier combo — never clobbers a
  // browser combo, never fires while merely typing without the modifier).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        handleOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleOpenChange]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [router, handleOpenChange],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[active];
      if (it) go(it.href);
    }
  };

  let runningIdx = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 rounded-card-lg fixed top-[12vh] left-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 overflow-hidden border border-[var(--b-strong)] bg-[var(--bg-2)] shadow-[var(--sh-tooltip)] outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Palette de commandes</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Recherche une page ou une action. Flèches haut/bas pour naviguer, Entrée pour valider,
            Échap pour fermer.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2.5 border-b border-[var(--b-default)] px-4">
            <Search className="h-4 w-4 shrink-0 text-[var(--t-3)]" strokeWidth={1.75} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="cmdk-list"
              aria-label="Rechercher une page ou une action"
              aria-activedescendant={filtered[active] ? `cmdk-opt-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Rechercher une page ou une action…"
              className="h-12 flex-1 bg-transparent text-[14px] text-[var(--t-1)] placeholder:text-[var(--t-4)] focus:outline-none"
            />
          </div>

          <div
            id="cmdk-list"
            role="listbox"
            aria-label="Résultats"
            ref={listRef}
            className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-[var(--t-3)]">
                Aucun résultat pour «&nbsp;{query.trim()}&nbsp;».
              </p>
            ) : (
              groups.map(([groupLabel, items]) => (
                <div key={groupLabel} className="mb-1 last:mb-0">
                  <p className="t-eyebrow px-2.5 pt-2 pb-1 text-[var(--t-4)]">{groupLabel}</p>
                  {items.map((it) => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    const isActive = idx === active;
                    const Icon = it.icon;
                    return (
                      <button
                        key={`${it.group}-${it.href}-${it.label}`}
                        id={`cmdk-opt-${idx}`}
                        data-idx={idx}
                        role="option"
                        aria-selected={isActive}
                        type="button"
                        onMouseMove={() => setActive(idx)}
                        onClick={() => go(it.href)}
                        className={cn(
                          'rounded-control flex w-full items-center gap-3 px-2.5 py-2 text-left text-[13px] transition-colors',
                          isActive ? 'bg-[var(--acc-dim)] text-[var(--t-1)]' : 'text-[var(--t-2)]',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0',
                            isActive ? 'text-[var(--acc)]' : 'text-[var(--t-3)]',
                          )}
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        <span className="flex-1 truncate">{it.label}</span>
                        {isActive ? (
                          <CornerDownLeft
                            className="h-3.5 w-3.5 shrink-0 text-[var(--t-4)]"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

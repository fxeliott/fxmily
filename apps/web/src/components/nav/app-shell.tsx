'use client';

import { LogOut, Menu as MenuIcon, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { BrandMark } from '@/components/brand/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { CommandPalette } from './command-palette';
import { BOTTOM_NAV, isNavItemActive, NAV_GROUPS, type NavItem } from './nav-items';

interface SessionLite {
  name: string;
  email: string;
  isAdmin: boolean;
}

interface AppShellProps {
  session: SessionLite | null;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * AppShell — chrome de navigation globale des routes AUTHENTIFIÉES.
 *
 * Avant : aucune nav globale, toutes les pages atteignables seulement en
 * scrollant un dashboard « tout sur une page ». Maintenant : sidebar groupée
 * (desktop ≥lg) + bottom tab bar (mobile, pattern PWA) + drawer plein menu.
 *
 * Monté UNE fois dans le root layout. Se retire de lui-même (rend seulement
 * `children`) sur les routes publiques ou hors session — la détection mirroite
 * `isPublic()` de auth.config.ts. Les décalages mobile (FAB, footer, cookie)
 * sont gérés en CSS via `[data-slot="app-bottom-nav"]` (globals.css).
 */
export function AppShell({ session, signOutAction, children }: AppShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  if (!session || isPublicPath(pathname)) {
    // Surfaces publiques (splash / login / onboarding / legal) : aucun chrome,
    // mais le toggle de thème reste accessible via un bouton flottant discret.
    return (
      <>
        {children}
        <ThemeToggle variant="floating" />
      </>
    );
  }

  const groups = NAV_GROUPS.filter((g) => !g.admin || session.isAdmin);

  return (
    <>
      {/* ── Sidebar desktop (≥ lg) ─────────────────────────────────── */}
      <aside
        data-slot="app-sidebar"
        aria-label="Navigation principale"
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[var(--b-default)] bg-[var(--bg)]/95 backdrop-blur lg:flex"
      >
        <Brand />
        <div className="px-3 pt-3">
          <SearchTrigger onClick={() => setCmdOpen(true)} />
        </div>
        <nav aria-label="Sections" className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
          {groups.map((group) => (
            <div key={group.label ?? 'root'} className="mb-4 last:mb-0">
              {group.label ? (
                <p className="t-eyebrow px-2 pb-1.5 text-[var(--t-4)]">{group.label}</p>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isNavItemActive(pathname, item.href)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <UserFooter session={session} signOutAction={signOutAction} />
      </aside>

      {/* ── Zone de contenu (décalée sous la sidebar en desktop) ───── */}
      <div className="flex flex-1 flex-col lg:pl-64">{children}</div>

      {/* ── Bottom tab bar (mobile < lg) ───────────────────────────── */}
      <nav
        data-slot="app-bottom-nav"
        aria-label="Navigation"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--b-default)] bg-[var(--bg-2)]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        {BOTTOM_NAV.map((item) => (
          <BottomLink key={item.href} item={item} active={isNavItemActive(pathname, item.href)} />
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className="group flex h-14 flex-col items-center justify-center gap-0.5 text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <MenuIcon
            className="h-5 w-5 transition-transform duration-200 group-active:scale-90"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="text-[10px] leading-none font-medium">Menu</span>
        </button>
      </nav>

      {/* ── Drawer plein menu (mobile) ─────────────────────────────── */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="w-[86%] max-w-xs border-r border-[var(--b-default)] bg-[var(--bg)] p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu de navigation</SheetTitle>
            <SheetDescription>Accède à toutes les sections de Fxmily.</SheetDescription>
          </SheetHeader>
          <Brand />
          <div className="px-3 pt-3">
            <SearchTrigger
              onClick={() => {
                closeMenu();
                setCmdOpen(true);
              }}
            />
          </div>
          <nav
            aria-label="Toutes les sections"
            className="scroll-thin flex-1 overflow-y-auto px-3 py-3"
          >
            {groups.map((group) => (
              <div key={group.label ?? 'root'} className="mb-4 last:mb-0">
                {group.label ? (
                  <p className="t-eyebrow px-2 pb-1.5 text-[var(--t-4)]">{group.label}</p>
                ) : null}
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        item={item}
                        active={isNavItemActive(pathname, item.href)}
                        onNavigate={closeMenu}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <UserFooter session={session} signOutAction={signOutAction} />
        </SheetContent>
      </Sheet>

      {/* ── ⌘K command palette (global, role-gated) ────────────────── */}
      <CommandPalette isAdmin={session.isAdmin} open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}

/** Search affordance that opens the ⌘K palette — so touch users (no keyboard)
 *  can reach it too. Visible in the desktop sidebar + the mobile drawer. */
function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts="Control+K Meta+K"
      aria-haspopup="dialog"
      className="rounded-control group flex w-full items-center gap-2.5 border border-[var(--b-default)] bg-[var(--bg-2)] px-2.5 py-2 text-[13px] text-[var(--t-3)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)] hover:text-[var(--acc-hi)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      <Search
        className="h-[18px] w-[18px] shrink-0 text-[var(--t-4)] transition-colors group-hover:text-[var(--acc-hi)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="flex-1 text-left">Rechercher…</span>
      <kbd className="rounded border border-[var(--b-strong)] bg-[var(--bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--t-4)]">
        ⌘K
      </kbd>
    </button>
  );
}

/** Routes publiques (mirroir de isPublic() — auth.config.ts) : pas de chrome. */
function isPublicPath(p: string): boolean {
  if (p === '/' || p === '/login' || p === '/rejoindre' || p === '/forgot-password') return true;
  return p.startsWith('/onboarding') || p.startsWith('/reset-password') || p.startsWith('/legal');
}

function Brand() {
  return (
    <Link
      href="/dashboard"
      className="surf-grad-soft group relative flex shrink-0 items-center gap-2.5 overflow-hidden border-b border-[var(--b-default)] px-4 py-3.5 transition-opacity hover:opacity-95"
    >
      <span className="rounded-control grid h-7 w-7 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)] shadow-[var(--acc-glow)] transition-transform duration-300 group-hover:scale-105">
        <BrandMark className="w-[17px]" />
      </span>
      <span className="f-display text-[15px] font-semibold tracking-[-0.01em] text-[var(--t-1)]">
        Fxmily
      </span>
    </Link>
  );
}

function NavLink({
  item,
  active,
  onNavigate = () => {},
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'rounded-control group relative flex items-center gap-3 overflow-hidden px-2.5 py-2 text-[13px] font-medium transition-[color,background-color] duration-150',
        active
          ? 'bg-gradient-to-r from-[var(--acc-dim)] to-[var(--acc-2-dim)] text-[var(--acc-hi)]'
          : 'text-[var(--t-2)] hover:bg-[var(--acc-dim-2)] hover:text-[var(--t-1)]',
      )}
    >
      {/* barre d'accent active (gauche) */}
      <span
        aria-hidden
        className={cn(
          'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-[var(--acc)] transition-transform duration-200',
          active ? 'scale-y-100' : 'scale-y-0',
        )}
      />
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:scale-110',
          active
            ? 'text-[var(--acc)] drop-shadow-[0_0_8px_var(--acc)]'
            : 'text-[var(--t-3)] group-hover:text-[var(--acc-hi)]',
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="truncate transition-transform duration-200 group-hover:translate-x-0.5">
        {item.label}
      </span>
    </Link>
  );
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-14 flex-col items-center justify-center gap-0.5 transition-colors',
        active ? 'text-[var(--acc-hi)]' : 'text-[var(--t-3)] hover:text-[var(--t-1)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0 h-0.5 w-8 rounded-full bg-[var(--acc)] transition-transform duration-200',
          active ? 'scale-x-100' : 'scale-x-0',
        )}
      />
      <Icon
        className={cn(
          'h-5 w-5 transition-transform duration-200 group-active:scale-90',
          active ? 'text-[var(--acc)]' : '',
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="text-[10px] leading-none font-medium">{item.label}</span>
    </Link>
  );
}

function UserFooter({
  session,
  signOutAction,
}: {
  session: SessionLite;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="shrink-0 border-t border-[var(--b-default)] p-3">
      <div className="mb-2 flex items-center gap-2.5 px-1">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--b-strong)] bg-[var(--bg-2)] text-[12px] font-semibold text-[var(--t-2)]">
          {initials(session.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-[var(--t-1)]">{session.name}</p>
          <p className="truncate text-[11px] text-[var(--t-4)]">
            {session.isAdmin ? 'Admin' : 'Membre'}
          </p>
        </div>
      </div>
      <ThemeToggle variant="inline" />
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-control group flex w-full items-center gap-2.5 border border-transparent px-2.5 py-2 text-[13px] font-medium text-[var(--t-3)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)] hover:text-[var(--acc-hi)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <LogOut
            className="h-[18px] w-[18px] shrink-0 transition-colors group-hover:text-[var(--acc-hi)]"
            strokeWidth={1.75}
            aria-hidden
          />
          Déconnexion
        </button>
      </form>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'F';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

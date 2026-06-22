'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

/**
 * Détection de hydratation sans `setState` dans un effet (interdit par la règle
 * eslint `react-hooks/set-state-in-effect`). `useSyncExternalStore` renvoie le
 * snapshot serveur (false) au SSR ET au 1er rendu d'hydratation, puis le
 * snapshot client (true) — exactement le comportement d'un mount-guard.
 */
const noopSubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * ThemeToggle — bascule clair / sombre (next-themes).
 *
 * - `inline`  : item plein-largeur pour la sidebar / le drawer (UserFooter).
 * - `floating`: bouton fixe coin haut-droit pour les surfaces publiques
 *   (splash / login / onboarding / legal) où l'AppShell ne rend aucun chrome.
 *
 * Guard hydratation : next-themes ne connaît le thème résolu qu'après le mount
 * (le SSR ne sait pas ce que le localStorage contient). On rend un placeholder
 * de mêmes dimensions tant que `mounted` est faux → zéro mismatch, zéro CLS.
 * Les deux icônes sont montées et croisées en opacité/rotation (compositor-only,
 * respecte prefers-reduced-motion via le filet global transition-duration).
 */
export function ThemeToggle({ variant = 'inline' }: { variant?: 'inline' | 'floating' }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const isDark = resolvedTheme === 'dark';
  const next = isDark ? 'light' : 'dark';
  const label = isDark ? 'Passer en mode clair' : 'Passer en mode sombre';

  if (variant === 'floating') {
    return (
      <button
        type="button"
        onClick={() => mounted && setTheme(next)}
        aria-label={mounted ? label : 'Changer de thème'}
        title={mounted ? label : 'Changer de thème'}
        className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-40 grid h-10 w-10 place-items-center rounded-full border border-[var(--b-default)] bg-[var(--bg-2)]/80 text-[var(--t-2)] shadow-[var(--sh-card)] backdrop-blur-md backdrop-saturate-150 transition-[color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--b-acc)] hover:text-[var(--acc-hi)] hover:shadow-[var(--acc-glow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <ToggleIcons mounted={mounted} isDark={isDark} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => mounted && setTheme(next)}
      aria-label={mounted ? label : 'Changer de thème'}
      title={mounted ? label : 'Changer de thème'}
      className="rounded-control flex w-full items-center gap-2.5 px-2.5 py-2 text-[13px] font-medium text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">
        <ToggleIcons mounted={mounted} isDark={isDark} />
      </span>
      <span suppressHydrationWarning>
        {mounted ? (isDark ? 'Mode clair' : 'Mode sombre') : 'Thème'}
      </span>
    </button>
  );
}

function ToggleIcons({ mounted, isDark }: { mounted: boolean; isDark: boolean }) {
  // Avant mount : Sun visible par défaut (placeholder neutre, dimensions fixes).
  const showSun = !mounted || !isDark;
  return (
    <span className="relative grid h-[18px] w-[18px] place-items-center" aria-hidden>
      <Sun
        className={cn(
          'absolute h-[18px] w-[18px] transition-[opacity,transform] duration-300',
          showSun ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0',
        )}
        strokeWidth={1.75}
      />
      <Moon
        className={cn(
          'absolute h-[18px] w-[18px] transition-[opacity,transform] duration-300',
          showSun ? 'rotate-90 opacity-0' : 'rotate-0 opacity-100',
        )}
        strokeWidth={1.75}
      />
    </span>
  );
}

'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * ThemeProvider — wrapper client autour de next-themes, monté depuis le root
 * layout (Server Component) à travers cette frontière `'use client'`.
 *
 * Stratégie (cf. globals.css §LIGHT THEME) :
 *   - `attribute="class"` → next-themes écrit `.dark` / `.light` sur <html> ;
 *     cohérent avec `@custom-variant dark (.dark)` et le bloc `.light`.
 *   - `defaultTheme="dark"` → l'identité DS-v3 (deep blue-black) reste le défaut.
 *   - `enableSystem={false}` → 2 états déterministes (le membre choisit), pas de
 *     bascule surprise selon l'OS ; le toggle reste un simple lune/soleil.
 *   - `disableTransitionOnChange` → pas de flash de transition globale au switch.
 *
 * Le script bloquant pré-hydratation injecté par next-themes pose la classe
 * AVANT le premier paint (zéro FOUC). `<html suppressHydrationWarning>` est
 * OBLIGATOIRE côté layout (la classe écrite client-side diffère du SSR).
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

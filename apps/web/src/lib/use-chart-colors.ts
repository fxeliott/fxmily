'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { CHART_COLORS, CHART_COLORS_LIGHT, type ChartColorKey } from './theme-colors';

/**
 * useChartColors — S18 : renvoie le set de couleurs chart (hex) correspondant au
 * thème résolu, pour que TOUS les charts Recharts flippent en clair/sombre.
 *
 * Pourquoi un hook (et pas `var(--token)` direct) : Recharts injecte la valeur
 * telle quelle en attribut SVG ; `fill="var(--x)"` n'est pas résolu sur Safari
 * <15.4 / certains WebView Android (rendu noir/vide) — c'est la raison d'être de
 * theme-colors.ts (hex). On garde donc des hex, mais on choisit le bon jeu au
 * runtime selon `resolvedTheme`.
 *
 * Anti-flash / anti-hydration-mismatch : `useSyncExternalStore` rend le snapshot
 * serveur (mounted=false) au SSR ET au 1er rendu client → on sert le set DARK
 * (défaut de l'app, defaultTheme="dark") tant que non monté, puis on bascule
 * une seule fois après mount si le thème résolu est "light". Même garde que
 * theme-toggle.tsx → zéro mismatch React, zéro flash.
 */
const noopSubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Widened to string values (the dark + light sets share keys but differ in
 * literal hex) so both jeux sont assignables au type de retour. */
export type ChartColors = Record<ChartColorKey, string>;

export function useChartColors(): ChartColors {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  return mounted && resolvedTheme === 'light' ? CHART_COLORS_LIGHT : CHART_COLORS;
}

/**
 * useIsLightTheme — S20 : même garde anti-mismatch que useChartColors, mais
 * expose juste le booléen « thème clair résolu (après mount) ». Sert aux
 * illustrations SVG client (MirrorHero / ABCDHero) qui choisissent un jeu de
 * couleurs hex selon le thème — hex en attribut SVG = WebView-safe (le caveat
 * `var()`-in-SVG ne s'applique pas), tout en flippant en clair. Faux au SSR et
 * au 1er rendu client (defaultTheme="dark") → zéro flash, zéro mismatch.
 */
export function useIsLightTheme(): boolean {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  return mounted && resolvedTheme === 'light';
}

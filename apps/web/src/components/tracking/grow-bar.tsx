'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * GrowBar (Tour 12 C) — barre de progression qui SE REMPLIT à l'entrée du
 * viewport, pour rendre la jauge de suivi vivante (data-viz vivante) sans changer
 * la structure accessible du widget parent (le `role="progressbar"` + aria-* reste
 * porté par le conteneur côté serveur).
 *
 * SSR-safe (leçon reduced-motion-hydration) : un seul arbre. Le remplissage est
 * rendu à sa valeur FINALE côté serveur et au 1er render client (`scaleX(pct)`,
 * visible sans JS) ; un `useEffect` l'« arme » ensuite — remise à 0 (frame masqué,
 * jamais servi au SSR) puis transition vers la valeur cible à l'entrée du viewport.
 * Sous reduced-motion on ne réarme pas : la barre reste pleine, immobile.
 * Compositor-only (transform: scaleX). Décoratif : la valeur est portée par le texte.
 */
export function GrowBar({ pct, className }: { pct: number; className?: string }) {
  const target = Math.min(1, Math.max(0, pct / 100));
  const ref = useRef<HTMLDivElement>(null);
  // 'final' = valeur cible (SSR / no-JS / reduced), 'pending' = 0 (armé), 'grow' = transition.
  const [phase, setPhase] = useState<'final' | 'pending' | 'grow'>('final');

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const node = ref.current;
    if (!node) return;

    setPhase('pending');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          requestAnimationFrame(() => setPhase('grow'));
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const scale = phase === 'pending' ? 0 : target;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{
        transform: `scaleX(${scale})`,
        transformOrigin: 'left',
        transition: phase === 'grow' ? 'transform 1100ms cubic-bezier(0.22,1,0.36,1)' : undefined,
      }}
    />
  );
}

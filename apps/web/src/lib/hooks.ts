'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Réutilisables côté client pour le design system Sprint #1.
 * Tous les hooks honorent prefers-reduced-motion (WCAG 2.3.3).
 */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Retourne true si l'utilisateur a activé prefers-reduced-motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

/**
 * Observe un élément pour déclencher une animation au premier scroll-in.
 * Retourne [ref, seen] — `seen` passe true et reste true.
 */
export function useInView<T extends Element = HTMLDivElement>(
  threshold = 0.25,
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

/**
 * Anime un nombre de 0 → target en `duration` ms avec easing cubic-out.
 * Si `start` est false, retourne 0. Si reduced-motion, retourne target directement.
 *
 * Stable React 19 : pas de setState synchrone dans useEffect (cascade render).
 * Reduced-motion court-circuite l'animation au niveau du return.
 */
export function useCountUp(target: number, duration = 1400, start = true): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(0);

  useEffect(() => {
    if (reduced || !start) return;
    let raf = 0;
    let t0: number | null = null;
    const tick = (t: number) => {
      if (t0 === null) t0 = t;
      const p = clamp((t - t0) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start, reduced]);

  return reduced ? target : start ? v : 0;
}

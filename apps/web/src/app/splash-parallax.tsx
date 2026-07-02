'use client';

import { useEffect, useRef } from 'react';

/**
 * Pointer-parallax discret sur l'emblème : rAF-throttlé, et désactivé sous
 * prefers-reduced-motion OU pointeur grossier (tactile) — l'emblème garde
 * alors son flottement CSS seul. Compositor-only (translate3d via --px/--py).
 *
 * Seul îlot client de la landing : le reste du splash (starfield, emblème,
 * copy, CTAs) est server-rendered — l'effet est purement progressif, le
 * HTML complet arrive sans attendre ce chunk.
 */
export function SplashParallax({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (reduce.matches || !fine.matches) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;
        const dy = (e.clientY / window.innerHeight - 0.5) * 2;
        const max = 10;
        el.style.setProperty('--px', `${(dx * max).toFixed(2)}px`);
        el.style.setProperty('--py', `${(dy * max).toFixed(2)}px`);
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="splash-parallax">
      {children}
    </div>
  );
}
